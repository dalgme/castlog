"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  expertProfileSchema,
  type ExpertProfileInput,
} from "@/lib/experts/schemas";

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
