import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmailProvider } from "@/lib/email/provider";

/**
 * 비밀번호 설정·재설정 메일 (계정 발급 안내 / 비밀번호 찾기).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * 캐스트로그는 셀프 회원가입이 아니다. 모듈 조합이 계약 정보라(CLAUDE.md §1-2-7)
 * 도입 신청 → 캐스트로그 확인 → 계정 발급 순서로 간다. 그래서 **신청 화면에는
 * 비밀번호 입력이 없다.** 여기까지는 설계대로다.
 *
 * 문제는 그다음이었다. 계정을 만들면 임시 비밀번호가 관리모드 화면에 한 번
 * 표시되고, 그걸 운영자가 손으로 옮겨 대표에게 전달해야 했다. 사람 손을 거치는
 * 전달은 반드시 빠진다 — 그러면 그 회사는 계정이 있는데도 못 들어온다.
 * 임시 비밀번호를 메신저로 흘리는 것도 그 자체로 좋지 않다.
 *
 * ── 그래서 ─────────────────────────────────────────────────────────────────
 * 계정을 만들면 **본인에게 바로 메일이 간다.** 메일 안의 링크로 본인이 직접
 * 비밀번호를 정한다. 임시 비밀번호는 이 경로가 실패했을 때를 위한 예비 수단으로만
 * 남는다(관리모드 화면에 계속 표시된다).
 *
 * 토큰은 Supabase가 발급한 것을 쓴다 — 우리가 별도 토큰을 만들면 만료·재사용·
 * 폐기 규칙을 또 구현해야 하고, 인증 토큰은 직접 만들수록 나빠진다. 다만
 * **링크 주소는 우리가 만든다**(buildRecoveryLink 주석 참조).
 *
 * '비밀번호 찾기'도 같은 경로를 쓴다. 두 메일이 서로 다른 방식으로 나가면
 * 한쪽만 조용히 깨져도 알아채지 못한다 — 실제로 그런 식으로 깨졌다.
 */

export type InviteResult = { ok: true } | { ok: false; error: string };

type LinkResult = { ok: true; link: string } | { ok: false; error: string };

/**
 * 비밀번호 설정 링크를 **우리 도메인 주소로** 만든다.
 *
 * generateLink가 돌려주는 action_link를 그대로 쓰면 Supabase의 verify 주소로
 * 갔다가, 토큰이 URL 프래그먼트(#)에 실려 되돌아온다. 프래그먼트는 브라우저가
 * 서버로 보내지 않는다. 그래서 서버 라우트는 아무것도 받지 못하고 로그인
 * 화면으로 튕긴다 — 실제로 그 증상이 났다("링크를 누르면 로그인 화면으로 간다").
 * PKCE(?code=)를 쓸 수도 없다. 계정을 만드는 시점에는 그 사람의 브라우저가
 * 없으므로 검증자를 맡길 데가 없다.
 *
 * hashed_token으로 우리 주소를 만들면 /auth/confirm이 서버에서 확인해 세션을
 * 쿠키에 심는다. 덤으로 Supabase의 Redirect URLs 허용 목록에 의존하지 않게 되어,
 * 그 설정이 어긋나 링크가 조용히 바뀌는 사고(직전에 겪은 것)도 사라진다.
 */
async function buildRecoveryLink(
  email: string,
  baseUrl: string
): Promise<LinkResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    return {
      ok: false,
      error: error?.message ?? "비밀번호 설정 링크를 만들지 못했습니다.",
    };
  }

  const link =
    `${baseUrl}/auth/confirm` +
    `?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
    `&type=recovery&next=${encodeURIComponent("/reset-password")}`;
  return { ok: true, link };
}

function senderAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    process.env.RESEND_FROM ??
    "CASTLOG <no-reply@castlog.kr>"
  );
}

function resolveBaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? null;
}

/** 대표 계정 발급 안내 — 관리모드에서 테넌트를 만들 때 자동 발송 */
export async function sendAccountInviteEmail(input: {
  email: string;
  name: string;
  tenantName: string;
}): Promise<InviteResult> {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    return { ok: false, error: "NEXT_PUBLIC_BASE_URL이 설정되지 않았습니다." };
  }

  const provider = resolveEmailProvider();
  if (!provider) {
    return {
      ok: false,
      error: "이메일 발송 제공자가 설정되지 않았습니다 (RESEND_API_KEY).",
    };
  }

  const built = await buildRecoveryLink(input.email, baseUrl);
  if (!built.ok) return built;

  const body = [
    `${input.name} 님, 안녕하세요.`,
    "",
    `캐스트로그에 ${input.tenantName}의 대표 계정이 만들어졌습니다.`,
    "아래 링크에서 비밀번호를 직접 설정하신 뒤 로그인해 주세요.",
    "",
    built.link,
    "",
    `로그인 주소: ${baseUrl}/login`,
    `계정(이메일): ${input.email}`,
    "",
    "링크는 일정 시간이 지나면 만료됩니다. 만료되었다면 로그인 화면의",
    "‘비밀번호 찾기’로 다시 받으실 수 있습니다.",
    "",
    "이 메일을 요청하지 않으셨다면 링크를 열지 마시고 hello@castlog.kr 로",
    "알려 주세요.",
    "",
    "— 캐스트로그 (castlog.kr)",
  ].join("\n");

  const sent = await provider.send({
    from: senderAddress(),
    to: input.email,
    subject: `[캐스트로그] ${input.tenantName} 대표 계정 비밀번호를 설정해 주세요`,
    text: body,
    replyTo: "hello@castlog.kr",
  });

  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/**
 * 비밀번호 찾기 — 로그인 화면에서 본인이 요청.
 *
 * Supabase 내장 발송(resetPasswordForEmail)을 쓰지 않는다. 그쪽은 Supabase의
 * 메일 템플릿·SMTP·Redirect URLs 설정에 함께 매달려 있어서, 계정 발급 메일과
 * 다른 이유로 따로 깨질 수 있다. 두 메일이 같은 경로를 쓰면 한쪽이 살아 있는
 * 한 다른 쪽도 살아 있다.
 */
export async function sendPasswordResetEmail(email: string): Promise<InviteResult> {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    return { ok: false, error: "NEXT_PUBLIC_BASE_URL이 설정되지 않았습니다." };
  }

  const provider = resolveEmailProvider();
  if (!provider) {
    return {
      ok: false,
      error: "이메일 발송 제공자가 설정되지 않았습니다 (RESEND_API_KEY).",
    };
  }

  const built = await buildRecoveryLink(email, baseUrl);
  if (!built.ok) return built;

  const body = [
    "안녕하세요, 캐스트로그입니다.",
    "",
    "비밀번호 재설정을 요청하셨습니다. 아래 링크에서 새 비밀번호를 정해 주세요.",
    "",
    built.link,
    "",
    `계정(이메일): ${email}`,
    "",
    "링크는 일정 시간이 지나면 만료됩니다. 만료되었다면 로그인 화면에서 다시",
    "요청해 주세요.",
    "",
    "본인이 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다. 비밀번호는 링크를",
    "열기 전까지 바뀌지 않습니다.",
    "",
    "— 캐스트로그 (castlog.kr)",
  ].join("\n");

  const sent = await provider.send({
    from: senderAddress(),
    to: email,
    subject: "[캐스트로그] 비밀번호 재설정 안내",
    text: body,
    replyTo: "hello@castlog.kr",
  });

  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}
