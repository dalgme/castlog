"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  createApprovalWithSteps,
  matchApprovalRule,
} from "@/lib/approvals/engine";
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
 * 프로젝트 생성 — **공통 기반** (모듈 조합과 무관하게 항상 제공, CLAUDE.md §1-2).
 * 어떤 기능을 쓰든 일은 프로젝트를 여는 데서 시작하므로 모듈 게이트를 걸지 않는다.
 * 21스텝 복사만 operations 모듈 활성 시에 한다.
 * RLS(projects_insert)가 관리자 이상 + 자사 테넌트를 강제한다.
 */
export async function createProject(
  input: ProjectCreateInput
): Promise<CreateProjectResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();

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
      budget_amount: data.budgetAmount ? parseInt(data.budgetAmount, 10) : null,
      description: data.description || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return { ok: false, error: "프로젝트 생성에 실패했습니다." };
  }

  // 기본 21스텝 복사 — operations 모듈 활성 테넌트만 (구성 정보만, 실적 없음)
  if (modules.operations) {
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

// ============================================================================
// 단계 23: 프로젝트 종료 기여도(합 100%) + 종료 품의서 게이트
// ============================================================================

type ProjectMgrSession = { userId: string; tenantId: string; role: string };

async function requireProjectManager(): Promise<
  { ok: true; session: ProjectMgrSession } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  // 종료 기여도·상태 전환은 프로젝트 기초 — 공통 기반이라 모듈 게이트가 없다.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "프로젝트 종료 권한이 없습니다 (관리자 이상)." };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

const contributionsSchema = z.object({
  projectId: z.string().uuid("프로젝트를 확인하세요."),
  rows: z
    .array(
      z.object({
        userId: z.string().uuid(),
        percentage: z
          .number({ invalid_type_error: "기여도는 숫자여야 합니다." })
          .int("기여도는 정수여야 합니다.")
          .min(0, "기여도는 0 이상이어야 합니다.")
          .max(100, "기여도는 100 이하여야 합니다."),
        note: z.string().max(200, "메모는 200자 이내로 입력하세요.").optional(),
      })
    )
    .max(100),
});
export type ContributionsInput = z.infer<typeof contributionsSchema>;

export type ProjectActionResult = { ok: true } | { ok: false; error: string };

/** 종료 기여도 저장 (관리자 이상). 자사 직원만, 완료/취소 프로젝트는 불가. */
export async function saveProjectContributions(
  input: ContributionsInput
): Promise<ProjectActionResult> {
  const auth = await requireProjectManager();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = contributionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const data = parsed.data;
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed" || project.status === "cancelled") {
    return { ok: false, error: "이미 종료·취소된 프로젝트는 기여도를 수정할 수 없습니다." };
  }

  // 자사 직원 검증 (RLS로 자사 사용자만 조회됨)
  const userIds = Array.from(new Set(data.rows.map((r) => r.userId)));
  const { data: tenantUsers } = userIds.length
    ? await supabase.from("users").select("id").in("id", userIds)
    : { data: [] };
  const validIds = new Set((tenantUsers ?? []).map((u) => u.id));
  if (userIds.some((id) => !validIds.has(id))) {
    return { ok: false, error: "자사 직원만 기여도 대상으로 지정할 수 있습니다." };
  }

  if (data.rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("project_contributions")
      .upsert(
        data.rows.map((r) => ({
          tenant_id: session.tenantId,
          project_id: data.projectId,
          user_id: r.userId,
          percentage: r.percentage,
          note: r.note?.trim() || null,
          created_by: session.userId,
        })),
        { onConflict: "project_id,user_id" }
      );
    if (upsertError) {
      return { ok: false, error: "기여도 저장에 실패했습니다. 다시 시도해 주세요." };
    }
  }

  // 목록에서 빠진 직원의 기여도는 제거
  let removeQuery = supabase
    .from("project_contributions")
    .delete()
    .eq("project_id", data.projectId);
  if (userIds.length > 0) {
    removeQuery = removeQuery.not(
      "user_id",
      "in",
      `(${userIds.join(",")})`
    );
  }
  await removeQuery;

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "project_contributions.save",
    resource_type: "project",
    resource_id: data.projectId,
    after_data: { count: data.rows.length },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export type ClosingResult =
  | { ok: true; submitted: boolean }
  | { ok: false; error: string };

/**
 * 프로젝트 종료 상신 (관리자 이상).
 * 기여도 합계 100% 필수. approvals 활성 시 종료 품의(approval_type=project) 상신,
 * 비활성 시 직접 종료(단독 동작).
 */
export async function submitProjectClosing(
  projectId: string
): Promise<ClosingResult> {
  const auth = await requireProjectManager();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status, closing_approval_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed") {
    return { ok: false, error: "이미 종료된 프로젝트입니다." };
  }
  if (project.status === "cancelled") {
    return { ok: false, error: "취소된 프로젝트는 종료할 수 없습니다." };
  }
  if (project.closing_approval_id) {
    return { ok: false, error: "이미 종료 품의가 진행 중입니다." };
  }

  const { data: contributions } = await supabase
    .from("project_contributions")
    .select("user_id, percentage, users (name)")
    .eq("project_id", projectId);
  const rows = contributions ?? [];
  if (rows.length === 0) {
    return { ok: false, error: "종료 기여도를 먼저 입력하세요 (합계 100%)." };
  }
  const total = rows.reduce((s, r) => s + r.percentage, 0);
  if (total !== 100) {
    return { ok: false, error: `기여도 합계가 100%가 아닙니다 (현재 ${total}%).` };
  }

  const modules = await getTenantModules();

  // approvals 비활성 — 결재 없이 직접 종료 (단독 동작 경로)
  if (!modules.approvals) {
    const { data: closed, error } = await supabase
      .from("projects")
      .update({ status: "completed", closed_at: new Date().toISOString() })
      .eq("id", projectId)
      .not("status", "in", "(completed,cancelled)")
      .select("id")
      .maybeSingle();
    if (error || !closed) {
      return { ok: false, error: "종료 처리에 실패했습니다." };
    }
    await supabase.from("audit_logs").insert({
      tenant_id: session.tenantId,
      actor_auth_user_id: session.userId,
      actor_role: session.role,
      action: "project.close_direct",
      resource_type: "project",
      resource_id: projectId,
    });
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    revalidatePath("/[tenantSlug]/projects", "page");
    return { ok: true, submitted: false };
  }

  // approvals 활성 — 종료 품의 상신 (승인 시 hook이 completed로 전이)
  const matched = await matchApprovalRule("project", 0);
  if (!matched) {
    return {
      ok: false,
      error:
        "프로젝트 품의에 적용할 전결규정이 없습니다. 전결규정(유형: 프로젝트 품의)을 등록한 뒤 다시 상신하세요.",
    };
  }

  const body = [
    `프로젝트: ${project.name}`,
    "",
    "참여 직원 기여도:",
    ...rows.map(
      (r) => `- ${r.users?.name ?? "(직원)"}: ${r.percentage}%`
    ),
    `합계: ${total}%`,
  ].join("\n");

  const created = await createApprovalWithSteps({
    tenantId: session.tenantId,
    requesterUserId: session.userId,
    title: `[프로젝트 종료] ${project.name}`,
    body,
    approvalType: "project",
    amount: 0,
    projectId,
    appliedRuleId: matched.ruleId,
    steps: matched.steps,
  });
  if (!created.ok) return created;

  const { error: linkError } = await supabase
    .from("projects")
    .update({ closing_approval_id: created.approvalId })
    .eq("id", projectId)
    .is("closing_approval_id", null);
  if (linkError) {
    return { ok: false, error: "프로젝트와 종료 품의 연결에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "project.close_submit",
    resource_type: "project",
    resource_id: projectId,
    after_data: { approval_id: created.approvalId },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, submitted: true };
}
