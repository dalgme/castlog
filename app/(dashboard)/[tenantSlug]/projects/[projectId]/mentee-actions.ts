"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { isPracticeMode } from "@/lib/practice/server";

/**
 * 컨설팅 세션 멘티 정보 (기획 확정 2026-08-30 — 34번).
 * 소속/직위/이름/아이템명/유형 — 섭외계획 품의 본문에 동봉된다.
 * 게이트는 세션 입력 축(planInput)과 동일, RLS가 프로젝트 가시성을 받친다.
 */

export type MenteeResult = { ok: true } | { ok: false; error: string };

const menteeSchema = z.object({
  slotId: z.string().uuid(),
  orgName: z.string().trim().min(1, "멘티 소속명을 입력하세요.").max(100),
  positionTitle: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1, "멘티 이름을 입력하세요.").max(50),
  itemName: z.string().trim().max(120).optional(),
  menteeType: z.string().trim().max(50).optional(),
});
export type MenteeInput = z.input<typeof menteeSchema>;

export async function addSlotMentee(input: MenteeInput): Promise<MenteeResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;

  const parsed = menteeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { count } = await supabase
    .from("slot_mentees")
    .select("id", { count: "exact", head: true })
    .eq("slot_id", d.slotId);

  const { error } = await supabase.from("slot_mentees").insert({
    tenant_id: auth.tenantId,
    slot_id: d.slotId,
    org_name: d.orgName,
    position_title: d.positionTitle || null,
    name: d.name,
    item_name: d.itemName || null,
    mentee_type: d.menteeType || null,
    sort_order: (count ?? 0) + 1,
    is_practice: await isPracticeMode(),
    created_by: auth.userId,
  });
  if (error) {
    return { ok: false, error: "멘티 등록에 실패했습니다 (시스템 오류·권한). 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export async function removeSlotMentee(menteeId: string): Promise<MenteeResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireExecGrade("planInput");
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: deleted, error } = await supabase
    .from("slot_mentees")
    .delete()
    .eq("id", menteeId)
    .select("id")
    .maybeSingle();
  if (error || !deleted) {
    return { ok: false, error: "멘티 삭제에 실패했습니다. 새로고침 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
