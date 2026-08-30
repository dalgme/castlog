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
 * 로그인은 원칙적으로 기존 계정만(shouldCreateUser=false). 신규 가입은
 * 등록 링크(/j) 경유가 기본이나, 예외로 **보유자료로 등록된 전문가**
 * (experts 행 존재 + auth_user_id 없음)는 첫 로그인에서 계정을 만들고
 * 인증 직후 레코드를 이어받는다 (개정 2026-08-22).
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

  // 보유자료로 등록된 전문가(experts 행은 있으나 인증 계정이 없는 경우)는
  // 첫 로그인에서 계정을 만들어야 한다 — 그 외에는 종전대로 기존 계정만.
  // 등록 여부 확인은 전역 판정이라 admin 클라이언트를 쓴다.
  let allowCreate = false;
  try {
    const { data: existingExpert } = await createAdminClient()
      .from("experts")
      .select("id, auth_user_id, is_active")
      .eq("phone", phone)
      .eq("is_practice", false) // 연습모드 가상 전문가는 실계정 대상이 아니다
      .maybeSingle();
    // 이용 중지된 전문가는 인증번호 발송 전에 막는다 — ban(계정 차단)은
    // 계정이 연결된 경우에만 작동하므로 이 판정이 유일한 공통 차단선이다.
    // (규칙 거부임을 명시 — §12-9)
    if (existingExpert && existingExpert.is_active === false) {
      return {
        ok: false,
        error:
          "이 번호의 계정은 이용이 중지된 상태입니다 (플랫폼 운영 기준). 문의는 캐스트로그로 연락해 주세요.",
      };
    }
    allowCreate = Boolean(existingExpert && !existingExpert.auth_user_id);
  } catch {
    // 판정 실패 시 기존 동작(생성 불가) 유지
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: allowCreate, channel: "sms" },
  });

  if (error) {
    if (/signups? not allowed/i.test(error.message)) {
      return {
        ok: false,
        error:
          "등록되지 않은 번호입니다. 기업에서 받은 전문가 등록 링크로 먼저 가입해 주세요.",
      };
    }
    const infra = /sms provider|hook|not enabled|unsupported/i.test(error.message);
    return {
      ok: false,
      error: infra
        ? "인증 문자 발송 설정이 아직 완료되지 않았습니다. 캐스트로그 운영 설정 문제이니 캐스트로그에 알려 주세요."
        : `인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요. (${error.message.slice(0, 120)})`,
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

  // 보유자료로 등록된 전문가 레코드 이어받기(claim) — 휴대폰 인증이 곧
  // 소유 증명이다. auth_user_id가 비어 있는 행만 잇는다 (탈취 불가 가드).
  try {
    const admin = createAdminClient();
    const { data: unclaimed } = await admin
      .from("experts")
      .select("id")
      .eq("phone", phone)
      .eq("is_practice", false) // 연습모드 가상 전문가는 이어받기 대상 제외
      .eq("is_active", true) // 이용 중지 건은 이어받기도 막는다 (관리모드 중지)
      .is("auth_user_id", null)
      .maybeSingle();
    if (unclaimed) {
      await admin
        .from("experts")
        .update({ auth_user_id: data.user.id })
        .eq("id", unclaimed.id)
        .is("auth_user_id", null);
    }
  } catch {
    // 클레임 실패해도 로그인은 유효 — 다음 로그인에서 재시도된다
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
