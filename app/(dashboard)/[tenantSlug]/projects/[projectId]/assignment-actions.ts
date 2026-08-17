"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

export type AssignResult = { ok: true } | { ok: false; error: string };

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "프로젝트 배정 권한이 없습니다(대표·이사 등)." };
  }
  return { ok: true, userId: user.id, tenantId };
}

/** 프로젝트에 담당자 배정 (권한자만). */
export async function assignProjectMember(
  projectId: string,
  userId: string
): Promise<AssignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  // 대상이 같은 테넌트의 활성 직원인지 확인
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== auth.tenantId || !target.is_active) {
    return { ok: false, error: "같은 기업의 활성 직원만 배정할 수 있습니다." };
  }

  const { error } = await supabase.from("project_assignments").insert({
    tenant_id: auth.tenantId,
    project_id: projectId,
    user_id: userId,
    assigned_by: auth.userId,
  });
  if (error) {
    if (error.code === "23505") return { ok: true }; // 이미 배정됨 — 멱등
    return { ok: false, error: "배정에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/projects", "page");
  return { ok: true };
}

/** 프로젝트 담당자 배정 해제 (권한자만). */
export async function unassignProjectMember(
  projectId: string,
  userId: string
): Promise<AssignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { error } = await supabase
    .from("project_assignments")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "해제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects", "page");
  return { ok: true };
}
