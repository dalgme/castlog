"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import {
  expertOtpSchema,
  expertPhoneSchema,
  sanitizeNextPath,
  type ExpertOtpInput,
  type ExpertPhoneInput,
} from "@/lib/auth/schemas";

export type OtpRequestResult = { ok: true } | { ok: false; error: string };
export type OtpVerifyError = { error: string };

/**
 * 전문가 휴대폰 OTP 발송 (설계문서 3.2 — 전문가 계정은 휴대폰 인증 기반)
 *
 * shouldCreateUser=false: 로그인은 기존 계정만. 신규 전문가 가입은
 * 기업이 발송한 등록 링크(/j)를 통해서만 이뤄진다 (단계 6).
 * SMS 발송 자체는 Supabase Auth(SMS Hook — 알리고/NHN Cloud 연동)가 수행한다.
 */
export async function requestExpertOtp(
  input: ExpertPhoneInput
): Promise<OtpRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요." };
  }

  const parsed = expertPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const phone = normalizeKrMobileE164(parsed.data.phone);
  if (!phone) {
    return { ok: false, error: "올바른 휴대폰 번호가 아닙니다." };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: false, channel: "sms" },
  });

  if (error) {
    if (/signups? not allowed/i.test(error.message)) {
      return {
        ok: false,
        error:
          "등록되지 않은 번호입니다. 기업에서 받은 전문가 등록 링크로 먼저 가입해 주세요.",
      };
    }
    return {
      ok: false,
      error: "인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return { ok: true };
}

/**
 * OTP 검증 후 전문가 포털로 이동.
 * 최초 로그인이고 role이 비어 있으면 role=expert를 스탬핑한다
 * (app_metadata는 service_role만 수정 가능 — 기존 role은 절대 덮어쓰지 않는다).
 */
export async function verifyExpertOtp(
  input: ExpertOtpInput,
  next?: string | null
): Promise<OtpVerifyError> {
  if (!hasSupabaseEnv()) {
    return { error: "서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요." };
  }

  const parsed = expertOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const phone = normalizeKrMobileE164(parsed.data.phone);
  if (!phone) {
    return { error: "올바른 휴대폰 번호가 아닙니다." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: parsed.data.token,
    type: "sms",
  });

  if (error || !data.user) {
    return { error: "인증번호가 올바르지 않거나 만료되었습니다." };
  }

  if (!data.user.app_metadata?.role) {
    try {
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: { role: "expert" },
      });
      // 갱신된 app_metadata가 담긴 새 JWT 발급
      await supabase.auth.refreshSession();
    } catch {
      // service_role 키 미설정 등 — 스탬핑 실패해도 로그인 자체는 유효.
      // 등록 플로우(단계 6)가 role 스탬핑을 보장하므로 여기서는 차단하지 않는다.
    }
  }

  redirect(sanitizeNextPath(next) ?? "/expert");
}
