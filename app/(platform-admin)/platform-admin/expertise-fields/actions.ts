"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";

export type ExpertiseFieldResult = { ok: true } | { ok: false; error: string };

const nameSchema = z
  .string()
  .trim()
  .min(1, "분야명을 입력하세요.")
  .max(30, "분야명은 30자 이내로 입력하세요.");

async function requirePlatformAdmin(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true };
}

/**
 * 강의분야 전역 마스터 관리 (캐스트로그 관리모드 — 기획 확정 2026-08-22).
 * 전문가가 프로필에서 중복 선택하는 선택지다. 보유자료 일괄등록의 엑셀 값도
 * 여기로 승격되므로, 오타·중복 항목은 이 화면에서 정리한다.
 */
export async function createExpertiseField(
  name: string
): Promise<ExpertiseFieldResult> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return gate;

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const { error } = await createAdminClient()
    .from("expertise_fields")
    .insert({ name: parsed.data });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 분야명입니다." : "저장에 실패했습니다.",
    };
  }

  revalidatePath("/platform-admin/expertise-fields", "page");
  return { ok: true };
}

/** 이름 수정 — id가 유지되므로 전문가들의 선택은 그대로 남는다. */
export async function renameExpertiseField(
  fieldId: string,
  name: string
): Promise<ExpertiseFieldResult> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return gate;

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const { error } = await createAdminClient()
    .from("expertise_fields")
    .update({ name: parsed.data })
    .eq("id", fieldId);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 분야명입니다." : "변경에 실패했습니다.",
    };
  }

  revalidatePath("/platform-admin/expertise-fields", "page");
  return { ok: true };
}

/**
 * 활성/비활성 전환 — 삭제 대신 비활성화(§14-4). 비활성 분야는 전문가의
 * 새 선택지에서 빠지지만, 이미 선택해 둔 전문가의 표시는 유지된다.
 */
export async function setExpertiseFieldActive(
  fieldId: string,
  active: boolean
): Promise<ExpertiseFieldResult> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return gate;

  const { error } = await createAdminClient()
    .from("expertise_fields")
    .update({ is_active: active })
    .eq("id", fieldId);
  if (error) return { ok: false, error: "변경에 실패했습니다." };

  revalidatePath("/platform-admin/expertise-fields", "page");
  return { ok: true };
}
