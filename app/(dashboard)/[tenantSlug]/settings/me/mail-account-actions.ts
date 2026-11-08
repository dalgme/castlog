"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingTableError } from "@/lib/supabase/errors";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import { requireTenantStaff } from "@/lib/projects/team";
import { explainActionError } from "@/lib/ux/action-errors";
import { isPersonalMailAllowed, verifyPersonalAccount } from "@/lib/email/mail-accounts";
import {
  MAIL_PROVIDERS,
  MAIL_PROVIDER_PRESETS,
  type MailAccountStatus,
  type MailAccountView,
  type MailProvider,
} from "@/lib/email/mail-accounts-shared";

/**
 * 내 메일 계정(SMTP) 설정 (기획 지시 2026-11-08) — 본인 행만. 비밀번호는 암호화 저장·재표시 없음.
 * 저장 = 로그인 확인 + 본인 주소로 테스트 메일 1통 성공 시에만 활성(verified_at).
 */

type Result = { ok: true } | { ok: false; error: string };
const NOT_READY = "개인 메일 계정 발송 기능이 아직 열리지 않았습니다 (상태 미충족 — 데이터베이스 마이그레이션 0018 적용 전). 관리자에게 적용을 요청해 주세요.";

function toView(row: {
  provider: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  username: string;
  from_email: string;
  is_active: boolean;
  verified_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  updated_at: string;
}): MailAccountView {
  return {
    provider: (MAIL_PROVIDERS as readonly string[]).includes(row.provider) ? (row.provider as MailProvider) : "custom",
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    username: row.username,
    fromEmail: row.from_email,
    isActive: row.is_active,
    verifiedAt: row.verified_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function getMyMailAccountStatus(): Promise<MailAccountStatus> {
  const empty: MailAccountStatus = { ready: false, allowed: false, account: null, canStoreSecrets: hasSecretsKey() };
  if (!hasSupabaseEnv()) return empty;
  const gate = await requireTenantStaff();
  if (!gate.ok) return empty;
  const supabase = createClient();
  const [{ data, error }, allowed] = await Promise.all([
    supabase
      .from("user_mail_accounts")
      .select("provider, smtp_host, smtp_port, smtp_secure, username, from_email, is_active, verified_at, last_used_at, last_error, updated_at")
      .eq("user_id", gate.actor.userId)
      .maybeSingle(),
    isPersonalMailAllowed(gate.actor.tenantId),
  ]);
  if (error && isMissingTableError(error)) return empty;
  return { ready: true, allowed, account: data ? toView(data) : null, canStoreSecrets: hasSecretsKey() };
}

const saveSchema = z
  .object({
    provider: z.enum(MAIL_PROVIDERS),
    fromEmail: z.string().trim().email("메일 주소 형식을 확인하세요.").max(200),
    username: z.string().trim().max(200).optional().or(z.literal("")),
    password: z.string().min(1, "앱 비밀번호를 입력하세요.").max(200),
    smtpHost: z.string().trim().max(200).optional().or(z.literal("")),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.provider === "custom" && !v.smtpHost?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpHost"], message: "SMTP 서버 주소를 입력하세요." });
    }
  });
export type SaveMailAccountInput = z.infer<typeof saveSchema>;

export type SaveMailAccountResult = { ok: true; verified: true } | { ok: false; error: string };

/** 저장 + 테스트 발송 — 성공해야 활성이 된다 */
export async function saveAndVerifyMyMailAccount(input: SaveMailAccountInput): Promise<SaveMailAccountResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!hasSecretsKey()) {
    return { ok: false, error: "서버에 SECRETS_ENCRYPTION_KEY가 설정되지 않아 비밀번호를 안전하게 저장할 수 없습니다 (시스템 결함). 플랫폼 운영자에게 문의하세요." };
  }
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!(await isPersonalMailAllowed(gate.actor.tenantId))) {
    return { ok: false, error: "회사가 직원 개인 메일 계정 발송을 아직 허용하지 않았습니다 (규칙). 대표 또는 발송 설정 담당자에게 설정 > 발송에서 ‘직원 개인 계정 발송 허용’을 켜 달라고 요청하세요." };
  }
  const d = parsed.data;
  const preset = MAIL_PROVIDER_PRESETS[d.provider];
  const smtpHost = (d.provider === "custom" ? d.smtpHost?.trim() : preset.host) ?? "";
  const smtpPort = d.provider === "custom" ? d.smtpPort ?? preset.port : preset.port;
  const smtpSecure = d.provider === "custom" ? d.smtpSecure ?? preset.secure : preset.secure;
  const username = d.username?.trim() || (preset.usernameIsEmail ? d.fromEmail : d.fromEmail.split("@")[0] ?? d.fromEmail);

  const supabase = createClient();
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.actor.tenantId).maybeSingle();

  // 실제 로그인 + 본인 주소로 테스트 1통 — 통과하지 못한 설정은 저장하지 않는다(동작 안 하는 설정은 막다른 길 §14-7)
  const verified = await verifyPersonalAccount(
    { provider: d.provider, smtpHost, smtpPort, smtpSecure, username, fromEmail: d.fromEmail, password: d.password },
    { fromName: gate.actor.name || "담당자", tenantName: tenant?.name ?? "회사" }
  );
  if (!verified.ok) {
    await supabase.from("audit_logs").insert({
      tenant_id: gate.actor.tenantId,
      actor_auth_user_id: gate.actor.userId,
      actor_role: gate.actor.role,
      action: "mail_account.verify_failed",
      resource_type: "user_mail_account",
      after_data: { provider: d.provider, smtp_host: smtpHost, from_email: d.fromEmail, error: verified.error },
    });
    return { ok: false, error: `${verified.error} 설정은 저장되지 않았습니다.` };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("user_mail_accounts").upsert(
    {
      tenant_id: gate.actor.tenantId,
      user_id: gate.actor.userId,
      provider: d.provider,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_secure: smtpSecure,
      username,
      from_email: d.fromEmail,
      password_encrypted: encryptSecret(d.password),
      is_active: true,
      verified_at: now,
      last_error: null,
    },
    { onConflict: "tenant_id,user_id" }
  );
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "설정을 저장하지 못했습니다 (시스템 오류).") };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "mail_account.save",
    resource_type: "user_mail_account",
    after_data: { provider: d.provider, smtp_host: smtpHost, smtp_port: smtpPort, from_email: d.fromEmail },
  });
  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true, verified: true };
}

export async function setMyMailAccountActive(active: boolean): Promise<Result> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_mail_accounts")
    .update({ is_active: active })
    .eq("user_id", gate.actor.userId)
    .select("id, verified_at");
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "변경하지 못했습니다 (시스템 오류).") };
  }
  if (!data || data.length === 0) return { ok: false, error: "연결된 메일 계정이 없습니다 (상태 미충족). 먼저 계정을 연결하세요." };
  if (active && !data[0]?.verified_at) return { ok: false, error: "테스트 발송을 통과하지 않은 계정은 켤 수 없습니다 (규칙). 비밀번호를 다시 입력해 테스트하세요." };
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: active ? "mail_account.enable" : "mail_account.disable",
    resource_type: "user_mail_account",
    resource_id: data[0]?.id ?? null,
  });
  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true };
}

export async function deleteMyMailAccount(): Promise<Result> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const supabase = createClient();
  const { error } = await supabase.from("user_mail_accounts").delete().eq("user_id", gate.actor.userId);
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "삭제하지 못했습니다 (시스템 오류).") };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "mail_account.delete",
    resource_type: "user_mail_account",
  });
  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true };
}
