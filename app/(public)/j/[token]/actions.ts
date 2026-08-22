"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import { expertOtpSchema, expertPhoneSchema } from "@/lib/auth/schemas";
import {
  CURRENT_TERMS_VERSION,
  joinRegistrationSchema,
  type JoinRegistrationInput,
} from "@/lib/experts/schemas";
import { lookupInvitationByToken } from "@/lib/experts/invitations";

const INVALID_LINK_ERROR =
  "유효하지 않거나 만료된 등록 링크입니다. 기업 담당자에게 새 링크를 요청하세요.";

export type JoinStepResult = { ok: true } | { ok: false; error: string };

/**
 * 등록용 휴대폰 OTP 발송.
 * 로그인(/expert/login)과 달리 신규 계정 생성을 허용한다(shouldCreateUser=true) —
 * 단, 유효한 등록 토큰이 있을 때만. 링크에 번호가 지정된 경우 그 번호만 허용.
 */
export async function requestJoinOtp(
  token: string,
  input: { phone: string }
): Promise<JoinStepResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = expertPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const lookup = await lookupInvitationByToken(token);
  if (!lookup.ok) {
    return { ok: false, error: INVALID_LINK_ERROR };
  }

  const phone = normalizeKrMobileE164(parsed.data.phone);
  if (!phone) {
    return { ok: false, error: "올바른 휴대폰 번호가 아닙니다." };
  }

  if (lookup.invitation.invited_phone && lookup.invitation.invited_phone !== phone) {
    return {
      ok: false,
      error: "이 링크는 지정된 휴대폰 번호로만 등록할 수 있습니다.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true, channel: "sms" },
  });

  if (error) {
    // 원인 단서를 함께 보여 준다(§12-9). 특히 인증 문자 인프라(Supabase Send
    // SMS Hook + 운영사 솔라피) 미설정은 여기서만 드러난다 — 삼키면 "문자가
    // 안 와요"라는 신고로만 돌아온다.
    const infra = /sms provider|hook|not enabled|unsupported/i.test(error.message);
    return {
      ok: false,
      error: infra
        ? "인증 문자 발송 설정이 아직 완료되지 않았습니다. 회사가 아니라 캐스트로그 운영 설정 문제이니 캐스트로그에 알려 주세요."
        : `인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요. (${error.message.slice(0, 120)})`,
    };
  }

  return { ok: true };
}

/** OTP 검증 — 성공 시 세션이 생성되고 프로필 입력 단계로 진행한다. */
export async function verifyJoinOtp(
  token: string,
  input: { phone: string; token: string }
): Promise<JoinStepResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = expertOtpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const lookup = await lookupInvitationByToken(token);
  if (!lookup.ok) {
    return { ok: false, error: INVALID_LINK_ERROR };
  }

  const phone = normalizeKrMobileE164(parsed.data.phone);
  if (!phone) {
    return { ok: false, error: "올바른 휴대폰 번호가 아닙니다." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: parsed.data.token,
    type: "sms",
  });

  if (error || !data.user) {
    return { ok: false, error: "인증번호가 올바르지 않거나 만료되었습니다." };
  }

  return { ok: true };
}

export type CompleteRegistrationError = { error: string };

/**
 * 등록 완료 — 전문가 소유 계정 생성 + 기업 연결 (설계문서 3.2).
 *
 * - experts는 전역 테이블: 휴대폰 번호가 이미 있으면 새로 만들지 않고
 *   기존 전문가 계정에 연결한다 (1인 1계정).
 * - 연결(expert_tenant_links)은 전문가 본인이 등록을 완료한 것이므로 즉시 active.
 * - 필수 동의는 항목별 개별 행으로 기록한다 (설계문서 14.6).
 */
export async function completeExpertRegistration(
  token: string,
  input: JoinRegistrationInput
): Promise<CompleteRegistrationError> {
  if (!hasSupabaseEnv()) {
    return { error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = joinRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const lookup = await lookupInvitationByToken(token);
  if (!lookup.ok) {
    return { error: INVALID_LINK_ERROR };
  }
  const invitation = lookup.invitation;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.phone) {
    return { error: "휴대폰 인증을 먼저 완료해 주세요." };
  }

  // Supabase는 phone을 '8210...' 형태로 저장 — E.164로 통일해 대조·저장한다
  const phone = normalizeKrMobileE164(user.phone);
  if (!phone) {
    return { error: "인증된 휴대폰 번호를 확인할 수 없습니다." };
  }

  if (invitation.invited_phone && invitation.invited_phone !== phone) {
    return { error: "이 링크는 지정된 휴대폰 번호로만 등록할 수 있습니다." };
  }

  // 이미 기업 소속(직원) 역할을 가진 계정으로는 전문가 등록을 막는다.
  // 직원 계정에 전문가 링크가 붙으면 role은 그대로 둔 채 타 테넌트 접근이
  // 열리는 권한 혼선이 생긴다 — 전문가는 별도 계정으로 등록해야 한다.
  const existingRole = user.app_metadata?.role;
  if (existingRole && existingRole !== "expert") {
    return {
      error:
        "이미 기업 직원 계정으로 로그인되어 있습니다. 전문가 등록은 별도 계정(다른 휴대폰)으로 진행해 주세요.",
    };
  }

  const admin = createAdminClient();

  // 1) 전문가 계정 — 휴대폰 기준 1인 1계정 (기존 계정이 있으면 연결만)
  const { data: existingExpert } = await admin
    .from("experts")
    .select("id, auth_user_id")
    .eq("phone", phone)
    .maybeSingle();

  let expertId: string;

  if (existingExpert) {
    if (existingExpert.auth_user_id && existingExpert.auth_user_id !== user.id) {
      return { error: "이미 다른 계정에 연결된 휴대폰 번호입니다. 고객센터에 문의하세요." };
    }
    expertId = existingExpert.id;
    if (!existingExpert.auth_user_id) {
      const { error: claimError } = await admin
        .from("experts")
        .update({ auth_user_id: user.id })
        .eq("id", expertId)
        .is("auth_user_id", null);
      if (claimError) {
        return { error: "계정 연결에 실패했습니다. 다시 시도해 주세요." };
      }
    }
  } else {
    const { data: created, error: createError } = await admin
      .from("experts")
      .insert({
        auth_user_id: user.id,
        name: parsed.data.name,
        phone,
        email: parsed.data.email || null,
        specialty: parsed.data.specialty || null,
        region: parsed.data.region || null,
        career_years: parsed.data.careerYears
          ? parseInt(parsed.data.careerYears, 10)
          : null,
        bio: parsed.data.bio || null,
      })
      .select("id")
      .single();
    if (createError || !created) {
      return { error: "전문가 계정 생성에 실패했습니다. 다시 시도해 주세요." };
    }
    expertId = created.id;
  }

  // 2) 기업 연결 — 본인이 등록을 완료했으므로 즉시 active
  const { data: existingLink } = await admin
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", invitation.tenant_id)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (existingLink) {
    if (existingLink.status !== "active") {
      const { error: linkError } = await admin
        .from("expert_tenant_links")
        .update({ status: "active", accepted_at: nowIso, revoked_at: null })
        .eq("id", existingLink.id);
      if (linkError) {
        return { error: "기업 연결에 실패했습니다. 다시 시도해 주세요." };
      }
    }
  } else {
    const { error: linkError } = await admin.from("expert_tenant_links").insert({
      expert_id: expertId,
      tenant_id: invitation.tenant_id,
      status: "active",
      accepted_at: nowIso,
    });
    if (linkError) {
      return { error: "기업 연결에 실패했습니다. 다시 시도해 주세요." };
    }
  }

  // 3) 필수 동의 — 항목별 개별 기록 (묶음 금지)
  await admin.from("consents").insert([
    {
      auth_user_id: user.id,
      consent_type: "terms_of_service",
      granted: true,
      terms_version: CURRENT_TERMS_VERSION,
    },
    {
      auth_user_id: user.id,
      consent_type: "privacy_collection",
      granted: true,
      terms_version: CURRENT_TERMS_VERSION,
    },
  ]);

  // 4) 등록 요청 완료 처리
  await admin
    .from("expert_invitations")
    .update({
      status: "completed",
      completed_expert_id: expertId,
      completed_at: nowIso,
    })
    .eq("id", invitation.id);

  // 5) role=expert 스탬핑 (비어 있을 때만 — 기존 role은 덮어쓰지 않는다)
  if (!user.app_metadata?.role) {
    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { role: "expert" },
    });
    await supabase.auth.refreshSession();
  }

  // 6) 감사 로그
  await admin.from("audit_logs").insert({
    tenant_id: invitation.tenant_id,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "expert.register",
    resource_type: "expert",
    resource_id: expertId,
  });

  redirect("/expert");
}
