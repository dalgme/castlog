"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";

export type RecruitFieldResult = { ok: true } | { ok: false; error: string };

const nameSchema = z
  .string()
  .trim()
  .min(1, "섭외분야명을 입력하세요.")
  .max(30, "섭외분야명은 30자 이내로 입력하세요.");

/**
 * 섭외분야 사전 관리 (대표 또는 settings 위임자 — 기획 확정 2026-08-22).
 *
 * 전문가 관리 탭에서 전문가에게 붙이는 자사 전용 분류다. 회사마다 다르고
 * 자주 바뀌므로 설정으로 둔다(§14-2). 사용자 요청에 따라 삭제를 제공한다 —
 * 삭제하면 전문가들에게 붙어 있던 그 분야 배정도 함께 지워진다(FK cascade).
 */
export async function createRecruitField(
  name: string
): Promise<RecruitFieldResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) return session;

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("tenant_recruit_fields").insert({
    tenant_id: session.tenantId,
    name: parsed.data,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 섭외분야입니다." : "저장에 실패했습니다.",
    };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 이름 수정 — id가 유지되므로 전문가 배정은 그대로 남는다. */
export async function renameRecruitField(
  fieldId: string,
  name: string
): Promise<RecruitFieldResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) return session;

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("tenant_recruit_fields")
    .update({ name: parsed.data })
    .eq("id", fieldId)
    .eq("tenant_id", session.tenantId);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 섭외분야입니다." : "변경에 실패했습니다.",
    };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 삭제 — 전문가들에게 붙어 있던 이 분야 배정도 함께 삭제된다. */
export async function deleteRecruitField(
  fieldId: string
): Promise<RecruitFieldResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) return session;

  const supabase = createClient();
  const { error } = await supabase
    .from("tenant_recruit_fields")
    .delete()
    .eq("id", fieldId)
    .eq("tenant_id", session.tenantId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}
