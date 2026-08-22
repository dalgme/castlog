"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type SaveExpertiseResult = { ok: true } | { ok: false; error: string };

const inputSchema = z.object({
  fieldIds: z.array(z.string().uuid()).max(30),
  otherText: z.string().trim().max(200),
});

/**
 * 강의(멘토링) 분야 저장 — 전문가 본인 (기획 확정 2026-08-22).
 * 마스터(expertise_fields)에서 중복 선택 + '기타'는 자유 텍스트.
 * RLS(expert_expertise_fields_insert/delete)가 본인 행만 허용한다.
 */
export async function saveExpertExpertise(input: {
  fieldIds: string[];
  otherText: string;
}): Promise<SaveExpertiseResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가 프로필이 없습니다." };

  // 현재 선택과의 차이만 반영한다 (전체 삭제 후 재삽입은 이력이 사라진다)
  const { data: current } = await supabase
    .from("expert_expertise_fields")
    .select("field_id")
    .eq("expert_id", expert.id);
  const currentIds = new Set((current ?? []).map((r) => r.field_id));
  const nextIds = new Set(parsed.data.fieldIds);

  const toAdd = Array.from(nextIds).filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !nextIds.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("expert_expertise_fields")
      .upsert(
        toAdd.map((fieldId) => ({ expert_id: expert.id, field_id: fieldId })),
        { ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: "분야 저장에 실패했습니다." };
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("expert_expertise_fields")
      .delete()
      .eq("expert_id", expert.id)
      .in("field_id", toRemove);
    if (error) return { ok: false, error: "분야 저장에 실패했습니다." };
  }

  const { error: otherError } = await supabase
    .from("experts")
    .update({ expertise_other: parsed.data.otherText || null })
    .eq("id", expert.id);
  if (otherError) return { ok: false, error: "기타 분야 저장에 실패했습니다." };

  revalidatePath("/expert/profile");
  return { ok: true };
}
