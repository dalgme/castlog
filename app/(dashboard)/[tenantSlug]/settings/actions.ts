"use server";

import { createHash, timingSafeEqual } from "crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/db-errors";
import { explainActionError } from "@/lib/ux/action-errors";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import {
  platformSmsSchema,
  smsConfigSchema,
  type PlatformSmsInput,
  type SmsConfigInput,
} from "@/lib/messaging/schemas";
import { normalizeSenderDigits, sendTenantSms } from "@/lib/sms/send";
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

  if (data.provider === "nhncloud") {
    // 어댑터 미구현 — 저장을 허용하면 발송이 전부 실패하는 설정이 생긴다
    return {
      ok: false,
      error: "NHN Cloud 연동은 준비 중입니다. 솔라피 또는 알리고를 사용하세요.",
    };
  }
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
  const payload = {
    tenant_id: tenantId,
    // 자사 키를 저장하는 행위 = 자사 계정 방식 선택. platform이던 회사가
    // 돌아올 때 모드를 함께 바꾸지 않으면 발송은 계속 캐스트로그 계정으로 나간다.
    mode: "byo",
    provider: data.provider,
    api_key_encrypted: encryptSecret(data.apiKey),
    api_secret_encrypted: data.apiSecret ? encryptSecret(data.apiSecret) : null,
    sender_number: data.senderNumber,
    is_active: true,
  };
  let { error } = await supabase
    .from("tenant_sms_configs")
    .upsert(payload, { onConflict: "tenant_id" });

  if (error && isMissingColumnError(error.message)) {
    // mode 컬럼은 보류 중인 b 마이그레이션 소속이다. 그 마이그레이션이 아직
    // 적용되지 않은 DB에서 **기존 자사 키 저장이 인질로 잡히면 안 된다** —
    // mode 없이 재시도한다(구버전 스키마 그대로). b를 재개하는 시점에는
    // 마이그레이션이 전제이므로 이 우회는 자연히 쓰이지 않게 된다.
    const { mode: _mode, ...legacyPayload } = payload;
    void _mode;
    ({ error } = await supabase
      .from("tenant_sms_configs")
      .upsert(legacyPayload, { onConflict: "tenant_id" }));
  }

  if (error) {
    return { ok: false, error: await explainActionError(error.message, "설정을 저장하지 못했습니다.") };
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
  if (error) return { ok: false, error: await explainActionError(error.message, "상태를 변경하지 못했습니다.") };

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

/**
 * 캐스트로그 발송(b) 신청 — 캐스트로그(넥스트랩) 솔라피 계정으로 발송.
 *
 * 자사 솔라피 가입이 도입의 첫 관문에서 이탈 지점이 되는 작은 기업을 위한
 * 길이다. 자격증명은 서버 환경변수에만 있고 이 테넌트 행에는 저장되지 않는다.
 *
 * 진입은 캐스트로그 담당자가 알려준 **이용코드**로 한 번 인증한다. 코드는
 * 저장하지 않고 승인 시각만 남긴다 — 이후 담당자가 코드를 바꿔도 이미 승인된
 * 기업은 계속 쓴다("최초 기입하면 계속 사용"). 발신번호 변경도 재인증이 없다.
 *
 * 발신번호는 그 기업의 번호다. 다만 발신번호 사전등록제(전기통신사업법
 * 제84조의2) 때문에 그 번호를 **캐스트로그 솔라피 계정에 등록**하는 절차가
 * 기업마다 한 번 필요하다 — 화면에서 안내하고, 등록 전 발송은 공급자가
 * 거부하므로 테스트 발송으로 확인한다.
 */
export async function savePlatformSmsMode(
  input: PlatformSmsInput
): Promise<SaveSmsConfigResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = platformSmsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;
  const { userId, tenantId } = auth;

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("tenant_sms_configs")
    .select("platform_access_granted_at")
    .maybeSingle();
  const alreadyGranted = Boolean(existing?.platform_access_granted_at);

  // 최초 1회만 이용코드를 요구한다. 이미 승인된 회사는 발신번호 변경·재저장에
  // 코드가 필요 없다.
  if (!alreadyGranted) {
    const expected = process.env.PLATFORM_SMS_ACCESS_CODE;
    if (!expected) {
      return {
        ok: false,
        error:
          "캐스트로그 발송 이용코드가 아직 운영에 설정되지 않았습니다. 캐스트로그에 문의하세요.",
      };
    }
    const supplied = data.accessCode?.trim() ?? "";
    if (!supplied) {
      return { ok: false, error: "캐스트로그가 알려드린 이용코드를 입력하세요." };
    }
    // 해시 후 비교 — 길이 차이로 timingSafeEqual이 던지는 것을 막고,
    // 비교 시간으로 코드 길이가 새는 것도 막는다
    const a = createHash("sha256").update(supplied).digest();
    const b = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(a, b)) {
      return { ok: false, error: "이용코드가 올바르지 않습니다." };
    }
  }

  const { error } = await supabase.from("tenant_sms_configs").upsert(
    {
      tenant_id: tenantId,
      mode: "platform",
      provider: "solapi",
      // 플랫폼 발송은 자사 키가 없다 — 남아 있던 옛 키도 지운다
      api_key_encrypted: null,
      api_secret_encrypted: null,
      sender_number: data.senderNumber,
      platform_access_granted_at:
        existing?.platform_access_granted_at ?? new Date().toISOString(),
      is_active: true,
    },
    { onConflict: "tenant_id" }
  );
  if (error) {
    return { ok: false, error: await explainActionError(error.message, "설정을 저장하지 못했습니다.") };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: alreadyGranted ? "sms_config.platform_update" : "sms_config.platform_enroll",
    resource_type: "tenant_sms_config",
    after_data: { sender_number: data.senderNumber },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}

export type SmsSenderResult = { ok: true } | { ok: false; error: string };

/**
 * 발신번호 추가 (기획 확정 2026-08-22 — 발신번호 다중 등록).
 * 여기 등록해도 공급자(솔라피) 계정에 사전등록되지 않은 번호는 발송이
 * 거부된다 — 화면 문구로 안내하고, 저장은 막지 않는다 (사전등록이 먼저인
 * 회사도, 나중인 회사도 있다).
 */
export async function addSmsSender(
  phone: string,
  label: string
): Promise<SmsSenderResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;

  const digits = normalizeSenderDigits(phone);
  if (!/^0\d{7,10}$/.test(digits)) {
    return { ok: false, error: "발신번호는 0으로 시작하는 8~11자리 숫자여야 합니다." };
  }
  const trimmedLabel = label.trim().slice(0, 30);

  const supabase = createClient();
  const { error } = await supabase.from("tenant_sms_senders").insert({
    tenant_id: auth.tenantId,
    phone: digits,
    label: trimmedLabel || null,
    created_by: auth.userId,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "이미 등록된 발신번호입니다." };
    }
    return {
      ok: false,
      error: await explainActionError(error.message, "발신번호를 저장하지 못했습니다."),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: "sms_sender.add",
    resource_type: "tenant_sms_sender",
    after_data: { phone: digits, label: trimmedLabel || null },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}

/** 발신번호 삭제 — 대표번호(tenant_sms_configs.sender_number)는 여기서 못 지운다 */
export async function removeSmsSender(
  senderId: string
): Promise<SmsSenderResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const auth = await requireAdminScope("sending");
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: removed, error } = await supabase
    .from("tenant_sms_senders")
    .delete()
    .eq("id", senderId)
    .eq("tenant_id", auth.tenantId)
    .select("phone")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "발신번호를 삭제하지 못했습니다."),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.isCeo ? "org_admin" : "manager",
    action: "sms_sender.remove",
    resource_type: "tenant_sms_sender",
    after_data: { phone: removed?.phone ?? null },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  return { ok: true };
}
