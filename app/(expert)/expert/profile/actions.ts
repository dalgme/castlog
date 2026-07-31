"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  expertProfileSchema,
  type ExpertProfileInput,
} from "@/lib/experts/schemas";
import { taxTypeSchema, type TaxTypeInput } from "@/lib/payments/schemas";

export type UpdateProfileError = { error: string };

/** 전문가 프로필 수정 — RLS(experts_update_self)가 본인 행만 허용한다. */
export async function updateExpertProfile(
  input: ExpertProfileInput
): Promise<UpdateProfileError> {
  if (!hasSupabaseEnv()) {
    return { error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = expertProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const { data: updated, error } = await supabase
    .from("experts")
    .update({
      name: parsed.data.name,
      email: parsed.data.email || null,
      specialty: parsed.data.specialty || null,
      region: parsed.data.region || null,
      career_years: parsed.data.careerYears
        ? parseInt(parsed.data.careerYears, 10)
        : null,
      bio: parsed.data.bio || null,
    })
    .eq("auth_user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { error: "프로필 저장에 실패했습니다. 다시 시도해 주세요." };
  }

  redirect("/expert");
}

export type SetTaxTypeResult = { ok: true } | { ok: false; error: string };

/**
 * 소득유형 설정 (전문가 본인 — 기획 확정: 사업소득/기타소득/사업자)
 * 지급 품의 시점에 스냅샷되므로, 진행 중인 지급 건에는 소급되지 않는다.
 * 주민등록번호는 절대 다루지 않는다 — 지급유형만 (CLAUDE.md 5).
 */
export async function setExpertTaxType(
  input: TaxTypeInput
): Promise<SetTaxTypeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = taxTypeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) {
    return { ok: false, error: "전문가 프로필이 없습니다." };
  }

  // RLS(expert_tax_profiles_write)가 본인 행만 허용한다
  const { error } = await supabase.from("expert_tax_profiles").upsert(
    {
      expert_id: expert.id,
      payment_type: parsed.data.paymentType,
      business_registration_number:
        parsed.data.paymentType === "business"
          ? parsed.data.businessRegistrationNumber || null
          : null,
    },
    { onConflict: "expert_id" }
  );

  if (error) {
    return { ok: false, error: "소득유형 저장에 실패했습니다." };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}
