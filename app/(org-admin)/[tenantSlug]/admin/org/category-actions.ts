"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";

export type CategoryResult = { ok: true } | { ok: false; error: string };

const nameSchema = z
  .string()
  .trim()
  .min(1, "카테고리명을 입력하세요.")
  .max(30, "카테고리명은 30자 이내로 입력하세요.");

/**
 * 프로젝트 카테고리 관리 (대표 또는 settings 위임자).
 *
 * 카테고리명은 회사마다 다르고 자주 바뀌므로 코드가 아니라 설정으로 둔다
 * (CLAUDE.md §14-2). 삭제 대신 비활성화한다(§14-4) — 지우면 그 카테고리로
 * 집계해 둔 과거 프로젝트의 분류가 끊긴다.
 */
export async function createProjectCategory(
  name: string,
  description: string
): Promise<CategoryResult> {
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
  const { error } = await supabase.from("project_categories").insert({
    tenant_id: session.tenantId,
    name: parsed.data,
    description: description.trim() || null,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 카테고리명입니다." : "저장에 실패했습니다.",
    };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 활성/비활성 전환. 비활성 카테고리는 새 프로젝트에서 고를 수 없지만 기존 분류는 남는다. */
export async function setProjectCategoryActive(
  categoryId: string,
  active: boolean
): Promise<CategoryResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) return session;

  const supabase = createClient();
  const { error } = await supabase
    .from("project_categories")
    .update({ is_active: active })
    .eq("id", categoryId)
    .eq("tenant_id", session.tenantId);
  if (error) return { ok: false, error: "변경에 실패했습니다." };

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 이름·설명 수정. 카테고리 id는 그대로라 기존 프로젝트 분류가 유지된다. */
export async function renameProjectCategory(
  categoryId: string,
  name: string,
  description: string
): Promise<CategoryResult> {
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
    .from("project_categories")
    .update({ name: parsed.data, description: description.trim() || null })
    .eq("id", categoryId)
    .eq("tenant_id", session.tenantId);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "이미 있는 카테고리명입니다." : "변경에 실패했습니다.",
    };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}
