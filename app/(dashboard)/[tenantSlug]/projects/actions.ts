"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  projectCreateSchema,
  stepStatusSchema,
  type ProjectCreateInput,
  type StepStatusInput,
} from "@/lib/operations/schemas";
import { DEFAULT_LIFECYCLE_STEPS } from "@/lib/operations/steps";

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string };

/**
 * 프로젝트 생성 + 기본 21스텝 복사 (operations 모듈).
 * RLS(projects_insert)가 관리자 이상 + 자사 테넌트를 강제한다.
 */
export async function createProject(
  input: ProjectCreateInput
): Promise<CreateProjectResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  // 모듈 게이트 (CLAUDE.md 1-2-3)
  const modules = await getTenantModules();
  if (!modules.operations) {
    return { ok: false, error: "프로젝트 모듈이 비활성화된 테넌트입니다." };
  }

  const parsed = projectCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "프로젝트 생성 권한이 없습니다." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenantId,
      name: data.name,
      business_year: parseInt(data.businessYear, 10),
      client_name: data.clientName || null,
      code: data.code || null,
      starts_on: data.startsOn || null,
      ends_on: data.endsOn || null,
      description: data.description || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return { ok: false, error: "프로젝트 생성에 실패했습니다." };
  }

  // 기본 21스텝 복사 (구성 정보만 — 실적 데이터 없음)
  const { error: stepsError } = await supabase
    .from("project_lifecycle_steps")
    .insert(
      DEFAULT_LIFECYCLE_STEPS.map((step) => ({
        tenant_id: tenantId,
        project_id: project.id,
        step_no: step.stepNo,
        step_type: step.stepType,
        title: step.title,
      }))
    );

  if (stepsError) {
    // 스텝 생성 실패 시 프로젝트도 취소 상태로 표시하지 않고 제거 시도는 하지 않는다
    // (RLS에 delete 정책 없음) — 오류 반환으로 재시도 유도
    return { ok: false, error: "기본 스텝 생성에 실패했습니다. 다시 시도해 주세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "project.create",
    resource_type: "project",
    resource_id: project.id,
    after_data: { name: data.name, business_year: data.businessYear },
  });

  revalidatePath("/[tenantSlug]/projects", "page");
  return { ok: true, projectId: project.id };
}

export type StepActionResult = { ok: true } | { ok: false; error: string };

/** 스텝 상태 변경 — 완료 시각 기록, 완료 해제 시 초기화 */
export async function updateStepStatus(
  input: StepStatusInput
): Promise<StepActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.operations) {
    return { ok: false, error: "프로젝트 모듈이 비활성화된 테넌트입니다." };
  }

  const parsed = stepStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  const { data: updated, error } = await supabase
    .from("project_lifecycle_steps")
    .update({
      status: parsed.data.status,
      completed_at:
        parsed.data.status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.stepId)
    .select("id, project_id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "스텝 상태 변경에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "project_step.status_change",
    resource_type: "project_lifecycle_step",
    resource_id: updated.id,
    after_data: { status: parsed.data.status },
  });

  revalidatePath(`/[tenantSlug]/projects/${updated.project_id}`, "page");
  return { ok: true };
}
