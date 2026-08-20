import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmailProvider } from "@/lib/email/provider";

/**
 * 계정 발급 안내 메일 — "비밀번호는 어디서 받나"의 답.
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
 * 링크는 Supabase가 발급하는 복구 링크를 그대로 쓴다. 우리가 별도 토큰을 만들면
 * 만료·재사용·폐기 규칙을 또 구현해야 하고, 인증 토큰은 직접 만들수록 나빠진다.
 */

export type InviteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendAccountInviteEmail(input: {
  email: string;
  name: string;
  tenantName: string;
}): Promise<InviteResult> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "");
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

  const admin = createAdminClient();
  const redirectTo = `${baseUrl}/auth/callback?next=/reset-password`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: input.email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    return {
      ok: false,
      error: error?.message ?? "비밀번호 설정 링크를 만들지 못했습니다.",
    };
  }

  const actionLink = data.properties.action_link;

  /**
   * 발급된 링크가 우리가 요청한 곳으로 돌아오는지 확인한다.
   *
   * Supabase는 요청한 redirect_to가 허용 목록(Authentication > URL Configuration >
   * Redirect URLs)에 없으면 **거부하지 않고 조용히 Site URL로 바꿔치기한다.**
   * 그래서 링크는 정상으로 보이고 메일도 정상 발송되지만, 받는 사람이 누르면
   * 엉뚱한 곳으로 간다. 실제로 그렇게 나갔다 — Site URL이 scheme 없이
   * 'castlog.kr'로 저장되어 있어서, Supabase가 그것을 자기 도메인의 상대 경로로
   * 읽고 `{"error":"requested path is invalid"}`를 띄웠다.
   *
   * 깨진 링크를 보내는 것은 안 보내는 것보다 나쁘다. 받는 사람은 우리 서비스가
   * 고장 났다고 판단하고, 우리는 무엇이 잘못됐는지 알 길이 없다. 그래서 여기서
   * 잡아 **보내지 않고** 원인을 그대로 돌려준다.
   */
  const carried = (() => {
    try {
      return new URL(actionLink).searchParams.get("redirect_to");
    } catch {
      return null;
    }
  })();
  if (!carried || !carried.startsWith(`${baseUrl}/auth/callback`)) {
    return {
      ok: false,
      error:
        `Supabase가 복귀 주소를 '${carried ?? "(없음)"}'로 바꿨습니다. ` +
        `요청한 값은 '${redirectTo}' 입니다. 링크를 눌러도 로그인 화면으로 오지 ` +
        "못하므로 발송하지 않았습니다. Supabase 대시보드 > Authentication > " +
        `URL Configuration에서 Site URL을 '${baseUrl}'(scheme 포함)로 고치고, ` +
        `Redirect URLs에 '${baseUrl}/**'를 추가하세요.`,
    };
  }

  const from =
    process.env.EMAIL_FROM ??
    process.env.RESEND_FROM ??
    "CASTLOG <no-reply@castlog.kr>";

  const body = [
    `${input.name} 님, 안녕하세요.`,
    "",
    `캐스트로그에 ${input.tenantName}의 대표 계정이 만들어졌습니다.`,
    "아래 링크에서 비밀번호를 직접 설정하신 뒤 로그인해 주세요.",
    "",
    actionLink,
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
    from,
    to: input.email,
    subject: `[캐스트로그] ${input.tenantName} 대표 계정 비밀번호를 설정해 주세요`,
    text: body,
    replyTo: "hello@castlog.kr",
  });

  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}
