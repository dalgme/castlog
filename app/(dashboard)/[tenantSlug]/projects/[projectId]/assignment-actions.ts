"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { getAssignmentRoleMinGrades } from "@/lib/auth/exec-policy";
import { roleMinGradeError } from "@/lib/integrations/assignment-role-rules";
import { recordActionDenial } from "@/lib/monitoring/action-denials";
import {
  ASSIGNMENT_ROLE_LABELS,
  isAssignmentRole,
  type AssignmentRole,
} from "@/lib/integrations/assignment-roles";

export type AssignResult = { ok: true } | { ok: false; error: string };

/**
 * 배정 계단 (기획 확정 2026-08-30) — DB app.can_assign_project_role과 동일 유지:
 * 대표·이사 → PL 이하 전부 / PL(겸임) → PM 이하 / PM(겸임) → 부PM 이하 /
 * 부PM → 담당. 역할 최소 레벨(트리거)은 별개로 계속 강제된다.
 */
const ASSIGN_CASCADE: Record<string, readonly AssignmentRole[]> = {
  pl: ["pm", "deputy_pm", "member"],
  pl_pm: ["pm", "deputy_pm", "member"],
  pm: ["deputy_pm", "member"],
  deputy_pm: ["member"],
};

const CASCADE_HINT =
  " (배정 계단 규칙 — 대표·이사→PL 이하, PL→PM 이하, PM→부PM 이하, 부PM→담당)";

async function requireAssigner(
  projectId: string,
  targetRole: AssignmentRole
): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  // 대표·이사는 전 역할 지정 가능
  const grade = gradeFromUser(user);
  if (isUserGrade(grade) && canViewAllProjects(grade)) {
    return { ok: true, userId: user.id, tenantId };
  }

  // 그 외에는 이 프로젝트에서의 내 역할이 계단상 지정 가능한 역할인지 본다
  const { data: mine } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  const allowed = mine ? (ASSIGN_CASCADE[mine.assignment_role] ?? []) : [];
  if (!allowed.includes(targetRole)) {
    const message = mine
      ? `'${ASSIGNMENT_ROLE_LABELS[targetRole]}' 지정·해제는 지금 역할로 할 수 없습니다${CASCADE_HINT}. 상위 역할자에게 요청하세요.`
      : `이 프로젝트에 배정된 사람만 담당자를 지정할 수 있습니다${CASCADE_HINT}.`;
    await recordActionDenial({
      kind: `assign:${targetRole}`,
      message,
      resourceType: "project",
      resourceId: projectId,
      user,
    });
    return { ok: false, error: message };
  }
  return { ok: true, userId: user.id, tenantId };
}

/**
 * 역할별 최소 레벨 (기획 확정 2026-08-23, 회사 조정 가능):
 * 기본값 PL=레벨 3 · PM=레벨 4 · 부PM=레벨 5 · 담당=레벨 6(제한 없음).
 * DB 트리거(app.enforce_assignment_role_grade)와 같은 규칙 —
 * 여기서 먼저 걸러 사람이 읽을 문구로 돌려준다.
 */
async function roleGradeError(
  role: AssignmentRole,
  targetGrade: string | null
): Promise<string | null> {
  const mins = await getAssignmentRoleMinGrades();
  return roleMinGradeError(role, targetGrade, mins);
}

/** PL·PM은 프로젝트당 각 1명 — 부분 유니크 인덱스 위반을 사람이 읽을 문구로 바꾼다. */
function roleConflictError(role: AssignmentRole): string {
  if (role === "pl") {
    return "이 프로젝트에는 이미 PL(겸임 포함)이 지정되어 있습니다. 먼저 해제하거나 역할을 바꾸세요.";
  }
  if (role === "pm") {
    return `이 프로젝트에는 이미 ${ASSIGNMENT_ROLE_LABELS.pm}(겸임 포함)이 지정되어 있습니다. 먼저 해제하거나 역할을 바꾸세요.`;
  }
  if (role === "pl_pm") {
    return "이 프로젝트에는 이미 PL 또는 PM이 지정되어 있습니다. 겸임 지정 전에 기존 PL·PM을 해제하거나 역할을 바꾸세요.";
  }
  return "배정에 실패했습니다.";
}

/** 프로젝트에 담당자 배정 (권한자만). */
export async function assignProjectMember(
  projectId: string,
  userId: string,
  assignmentRole: string = "member"
): Promise<AssignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!isAssignmentRole(assignmentRole)) {
    return { ok: false, error: "담당 역할을 확인하세요." };
  }
  const auth = await requireAssigner(projectId, assignmentRole);
  if (!auth.ok) return auth;

  const supabase = createClient();
  // 대상이 같은 테넌트의 활성 직원인지 확인
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id, is_active, grade")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== auth.tenantId || !target.is_active) {
    return { ok: false, error: "같은 기업의 활성 직원만 배정할 수 있습니다." };
  }

  if (!isAssignmentRole(assignmentRole)) {
    return { ok: false, error: "담당 역할을 확인하세요." };
  }
  const gradeError = await roleGradeError(assignmentRole, target.grade);
  if (gradeError) return { ok: false, error: gradeError };

  const { error } = await supabase.from("project_assignments").insert({
    tenant_id: auth.tenantId,
    project_id: projectId,
    user_id: userId,
    assignment_role: assignmentRole,
    assigned_by: auth.userId,
  });
  if (error) {
    // (project_id, user_id) 중복이면 기존 역할 안내, PM/부PM 중복이면 안내.
    // 자동 PL(개설자) 때문에 '이미 배정된 사람'이 흔해졌다 — 조용한 성공으로
    // 두면 역할이 안 바뀌었는데 바뀐 줄 안다 (리뷰 9)
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("project_assignments")
        .select("assignment_role")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .maybeSingle();
      if (existing) {
        const label = isAssignmentRole(existing.assignment_role)
          ? ASSIGNMENT_ROLE_LABELS[existing.assignment_role]
          : existing.assignment_role;
        return {
          ok: false,
          error: `이미 '${label}'(으)로 배정되어 있습니다. 역할을 바꾸려면 배정 목록에서 역할 변경을 사용하세요.`,
        };
      }
      return { ok: false, error: roleConflictError(assignmentRole) };
    }
    // 역할 최소 레벨 트리거 거부 — 트리거 문구가 이미 사용자용 한국어다
    if (error.code === "23514") {
      return { ok: false, error: `${error.message} (권한 규칙)` };
    }
    return { ok: false, error: "배정에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/projects", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 담당 역할 변경 (PM ↔ 부PM ↔ 담당). 권한자만. */
export async function setAssignmentRole(
  projectId: string,
  userId: string,
  assignmentRole: string
): Promise<AssignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!isAssignmentRole(assignmentRole)) {
    return { ok: false, error: "담당 역할을 확인하세요." };
  }
  // 새 역할 기준으로 계단 판정 — 기존 역할은 RLS(update 정책)가 함께 본다
  const auth = await requireAssigner(projectId, assignmentRole);
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: target } = await supabase
    .from("users")
    .select("grade")
    .eq("id", userId)
    .maybeSingle();
  const gradeError = await roleGradeError(assignmentRole, target?.grade ?? null);
  if (gradeError) return { ok: false, error: gradeError };

  const { data: updated, error } = await supabase
    .from("project_assignments")
    .update({ assignment_role: assignmentRole })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: roleConflictError(assignmentRole) };
    }
    // 역할 최소 레벨 트리거 거부 — 트리거 문구가 이미 사용자용 한국어다
    if (error.code === "23514") {
      return { ok: false, error: `${error.message} (권한 규칙)` };
    }
    return { ok: false, error: "역할 변경에 실패했습니다." };
  }
  // RLS로 0행이 걸러지면 supabase는 에러 없이 넘어간다 — 조용한 무시 방지 (§12-9)
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: `역할 변경 권한이 없거나 대상 배정을 찾을 수 없습니다${CASCADE_HINT}. 현재 역할이 계단상 상위이면 상위 역할자에게 요청하세요.`,
    };
  }

  revalidatePath("/[tenantSlug]/projects", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 프로젝트 담당자 배정 해제 (권한자만). */
export async function unassignProjectMember(
  projectId: string,
  userId: string
): Promise<AssignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  // 해제 대상의 현재 역할 기준으로 계단 판정 (그 역할을 지정할 수 있는
  // 사람이 해제도 할 수 있다). 대상 조회는 계단 판정 전에 세션(RLS)으로.
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "해제할 배정을 찾을 수 없습니다. 새로고침 후 확인해 주세요." };
  }
  const targetRole = isAssignmentRole(existing.assignment_role)
    ? existing.assignment_role
    : ("member" as const);
  const auth = await requireAssigner(projectId, targetRole);
  if (!auth.ok) return auth;

  const { data: removed, error } = await supabase
    .from("project_assignments")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("id");
  if (error) return { ok: false, error: "해제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  if (!removed || removed.length === 0) {
    return {
      ok: false,
      error: `해제 권한이 없거나 이미 해제되었습니다${CASCADE_HINT}.`,
    };
  }

  revalidatePath("/[tenantSlug]/projects", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
