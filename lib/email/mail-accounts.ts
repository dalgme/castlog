import "server-only";

import nodemailer from "nodemailer";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import { isMissingTableError } from "@/lib/supabase/errors";
import type { EmailMessage, EmailProviderResult } from "./provider";
import type { MailProvider } from "./mail-accounts-shared";

/**
 * 직원 개인 메일 계정(SMTP) 발송 (기획 지시 2026-11-08).
 *
 * 왜 SMTP인가: "각자 개인 계정으로 발송"의 가장 정직한 구현이다 — 메일이 실제로 그 계정에서 나가고
 * 직원 메일함의 보낸편지함에도 남는다. 회사 도메인 DNS 인증 없이 직원 스스로 켤 수 있다.
 * 한계: 공급자 웹훅이 없어 전달·열람 추적은 안 된다(발송 실패만 즉시 안다). 실패 시 플랫폼 발송으로 폴백한다.
 */

export type PersonalMailAccount = {
  id: string;
  provider: MailProvider;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  fromEmail: string;
  /** 복호화된 앱 비밀번호 — 메모리에서만, 로그·응답에 싣지 않는다 */
  password: string;
};

const CONNECTION_TIMEOUT_MS = 12_000;

/** 회사가 개인 계정 발송을 허용했는가 — 표 부재(0018 전)는 false */
export async function isPersonalMailAllowed(tenantId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("tenant_email_settings").select("personal_mail_allowed").eq("tenant_id", tenantId).maybeSingle();
  if (error) return false;
  return Boolean(data?.personal_mail_allowed);
}

/**
 * 발송에 쓸 개인 계정 — 회사 허용 + 본인 계정 활성 + 테스트 통과 + 암호화 키 존재일 때만.
 * service_role로 읽는다(발송 경로는 세션 RLS 밖에서도 돈다 — 크론·훅).
 */
export async function getActivePersonalMailAccount(tenantId: string, userId: string): Promise<PersonalMailAccount | null> {
  if (!hasSecretsKey()) return null;
  if (!(await isPersonalMailAllowed(tenantId))) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_mail_accounts")
    .select("id, provider, smtp_host, smtp_port, smtp_secure, username, from_email, password_encrypted, is_active, verified_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data || !data.is_active || !data.verified_at) return null;
  try {
    return {
      id: data.id,
      provider: data.provider as MailProvider,
      smtpHost: data.smtp_host,
      smtpPort: data.smtp_port,
      smtpSecure: data.smtp_secure,
      username: data.username,
      fromEmail: data.from_email,
      password: decryptSecret(data.password_encrypted),
    };
  } catch {
    // 키가 바뀌어 복호화 불가 — 계정을 못 쓰는 것으로 (플랫폼 폴백)
    return null;
  }
}

function transportFor(account: Omit<PersonalMailAccount, "id">) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.username, pass: account.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: CONNECTION_TIMEOUT_MS * 2,
    ...(account.smtpSecure ? {} : { requireTLS: true }),
  });
}

function describeSmtpError(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; message?: string } | null;
  const msg = (e?.message ?? "").slice(0, 200);
  if (e?.responseCode === 535 || /auth|credential|password|login/i.test(msg)) {
    return "로그인 실패 — 메일 주소 또는 앱 비밀번호가 맞지 않거나, 외부 메일 앱(SMTP) 사용이 꺼져 있습니다.";
  }
  if (e?.code === "ECONNECTION" || e?.code === "ETIMEDOUT" || e?.code === "ESOCKET" || /timeout|ECONN/i.test(msg)) {
    return "메일 서버에 연결하지 못했습니다 — 서버 주소·포트·보안(SSL) 설정을 확인하세요.";
  }
  return msg || "알 수 없는 오류";
}

/**
 * 개인 계정으로 1건 발송. 보낸 사람은 **직원 본인 주소**다(공급자가 From과 로그인 계정이 다르면 거부하므로
 * from_email을 쓴다). 실패하면 사유를 돌려주고 호출부(send.ts)가 플랫폼 발송으로 폴백한다.
 */
export async function sendViaPersonalAccount(
  account: PersonalMailAccount,
  message: Omit<EmailMessage, "from"> & { fromName: string }
): Promise<EmailProviderResult> {
  try {
    const info = await transportFor(account).sendMail({
      from: { name: message.fromName, address: account.fromEmail },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { ok: true, id: typeof info.messageId === "string" ? info.messageId : null };
  } catch (error) {
    return { ok: false, error: describeSmtpError(error) };
  }
}

/** 설정 저장 시 검증 — 로그인 확인 후 본인 주소로 테스트 메일 1통 */
export async function verifyPersonalAccount(
  account: Omit<PersonalMailAccount, "id">,
  test: { fromName: string; tenantName: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transport = transportFor(account);
  try {
    await transport.verify();
  } catch (error) {
    return { ok: false, error: describeSmtpError(error) };
  }
  try {
    await transport.sendMail({
      from: { name: test.fromName, address: account.fromEmail },
      to: account.fromEmail,
      subject: `[${test.tenantName}] 캐스트로그 개인 메일 계정 연결 테스트`,
      text: [
        `${test.fromName} 님, 캐스트로그에서 보낸 테스트 메일입니다.`,
        "",
        "이 메일이 보이면 개인 메일 계정 연결이 완료된 것입니다. 앞으로 섭외 요청·수락서 안내 메일이 이 계정에서 발송되며,",
        "보낸편지함에서도 확인할 수 있습니다.",
        "",
        `발송 시스템: CASTLOG (${test.tenantName})`,
      ].join("\n"),
    });
  } catch (error) {
    return { ok: false, error: `로그인은 되었지만 테스트 메일 발송에 실패했습니다: ${describeSmtpError(error)}` };
  }
  return { ok: true };
}

/** 발송 결과를 계정 행에 남긴다 (마지막 사용·마지막 오류) — 실패해도 발송 흐름을 막지 않는다 */
export async function recordPersonalAccountOutcome(accountId: string, error: string | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from("user_mail_accounts")
      .update(error ? { last_error: error } : { last_used_at: new Date().toISOString(), last_error: null })
      .eq("id", accountId);
    if (updateError && !isMissingTableError(updateError)) console.warn("[mail-accounts] outcome update failed:", updateError.message);
  } catch {
    /* 보조 기록 */
  }
}
