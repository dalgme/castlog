"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import { smsConfigSchema, type SmsConfigInput } from "@/lib/messaging/schemas";
import { sendTenantSms } from "@/lib/sms/send";
import { requireAdminScope } from "@/lib/auth/admin-scopes";

export type SaveSmsConfigResult = { ok: true } | { ok: false; error: string };

/**
 * SMS 공급자 설정 저장 (BYO — CLAUDE.md 5-2)
 * API 키·시크릿은 AES-256-GCM으로 암호화해 저장하고 화면에는 다시 보여주지 않는다.
 */
export async function saveSmsConfig(
  input: SmsConfigInput
): Promise<SaveSmsConfigResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!hasSecretsKey()) {
    return {
      ok: false,
      error:
        "서버에 SECRETS_ENCRYPTION_KEY가 설정되지 않아 API 키를 안전하게 저장할 수 없습니다. 플랫폼 운영자에게 문의하세요.",
    };
  }

  const parsed = smsConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  if (data.provider === "solapi" && !data.apiSecret) {
    return { ok: false, error: "솔라피는 API Secret이 필요합니다." };
  }
  if (data.provider === "aligo" && !data.apiSecret) {
    return { ok: false, error: "알리고는 사용자 ID(API Secret 칸)가 필요합니다." };
  }

  // 대표 또는 '발송 설정·템플릿' 위임을 받은 직원 (CLAUDE.md 3-1)
  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;
  const { userId, tenantId } = auth;

  const supabase = createClient();
  const { error } = await supabase.from("tenant_sms_configs").upsert(
    {
      tenant_id: tenantId,
      provider: data.provider,
      api_key_encrypted: encryptSecret(data.apiKey),
      api_secret_encrypted: data.apiSecret ? encryptSecret(data.apiSecret) : null,
      sender_number: data.senderNumber,
      is_active: true,
    },
    { onConflict: "tenant_id" }
  );

  if (error) {
    return { ok: false, error: "설정 저장에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: "sms_config.save",
    resource_type: "tenant_sms_config",
    after_data: { provider: data.provider, sender_number: data.senderNumber },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}

export type SmsTestResult =
  | { ok: true; testMode: boolean }
  | { ok: false; error: string };

/**
 * SMS 연결 테스트 — 저장된 자사 키로 실제 1건을 보내 본다.
 *
 * 설정만 저장하고 동작 여부를 알 수 없으면 실운영에서 첫 섭외요청이 조용히
 * 실패한다. 대표가 자기 번호로 즉시 확인할 수 있게 한다.
 * 업무연락(transactional)으로 발송되며 sms_logs에 그대로 기록된다.
 */
export async function testSmsConfig(testPhone: string): Promise<SmsTestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;
  const { userId, tenantId } = auth;

  const supabase = createClient();
  const digits = testPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) {
    return { ok: false, error: "테스트 수신 휴대폰 번호를 확인하세요." };
  }

  const { data: config } = await supabase
    .from("tenant_sms_configs")
    .select("is_active")
    .maybeSingle();
  if (!config) {
    return { ok: false, error: "먼저 공급자 설정을 저장하세요." };
  }
  if (!config.is_active) {
    return { ok: false, error: "발송이 비활성 상태입니다. 활성화 후 테스트하세요." };
  }

  const result = await sendTenantSms({
    tenantId,
    senderUserId: userId,
    messageType: "transactional",
    body: "[캐스트로그] SMS 발송 설정 연결 테스트입니다. 이 문자를 받으셨다면 정상 연결된 것입니다.",
    recipients: [{ phone: digits, expertId: null, name: "연결 테스트" }],
  });

  if (!result.ok) return { ok: false, error: result.error };
  if (result.summary.failed > 0 && result.summary.sent === 0) {
    return {
      ok: false,
      error:
        "공급자가 발송을 거부했습니다. API 키·발신번호(사전등록 여부)를 확인하세요. 상세 사유는 ‘발송’ 메뉴의 이력에서 볼 수 있습니다.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: "sms_config.test",
    resource_type: "tenant_sms_config",
    after_data: { test_mode: result.summary.testMode },
  });

  return { ok: true, testMode: result.summary.testMode };
}

/** 발송 활성/비활성 — 키를 지우지 않고 발송만 멈춘다 (§14-4). */
export async function setSmsConfigActive(
  active: boolean
): Promise<SaveSmsConfigResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;
  const { userId, tenantId } = auth;

  const supabase = createClient();
  const { error } = await supabase
    .from("tenant_sms_configs")
    .update({ is_active: active })
    .eq("tenant_id", tenantId);
  if (error) return { ok: false, error: "상태 변경에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: active ? "sms_config.activate" : "sms_config.deactivate",
    resource_type: "tenant_sms_config",
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}
