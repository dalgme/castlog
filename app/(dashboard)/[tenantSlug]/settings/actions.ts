"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import { smsConfigSchema, type SmsConfigInput } from "@/lib/messaging/schemas";

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

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || role !== "org_admin") {
    return { ok: false, error: "총괄관리자만 발송 설정을 변경할 수 있습니다." };
  }

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
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "sms_config.save",
    resource_type: "tenant_sms_config",
    after_data: { provider: data.provider, sender_number: data.senderNumber },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}
