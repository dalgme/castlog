"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { explainActionError } from "@/lib/ux/action-errors";
import {
  gradeFromUser,
  practiceFromUser,
  roleFromUser,
  tenantIdFromUser,
} from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { getAssignmentRoleMinGrades } from "@/lib/auth/exec-policy";
import { roleMinGradeError } from "@/lib/integrations/assignment-role-rules";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
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
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { CONTRIBUTION_SLOT_KEYS, isExtraSlot } from "@/lib/integrations/contribution-slots";

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
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("projectCreate", user))) {
    return { ok: false, error: await deniedExec("projectCreate") };
  }

  // 분류는 자사 카테고리만 — FK는 RLS를 우회하므로 소유를 직접 확인한다.
  // 정상 UI에서는 자사 목록에서만 고르지만, 요청은 조작될 수 있다.
  if (data.categoryId) {
    const { data: category } = await supabase
      .from("project_categories")
      .select("id")
      .eq("id", data.categoryId)
      .maybeSingle();
    if (!category) {
      return { ok: false, error: "선택한 프로젝트 카테고리를 찾을 수 없습니다." };
    }
  }

  // 중복 생성 가드 — 같은 이름·사업연도(또는 같은 코드)의 프로젝트가 이미
  // 있으면 막는다. 생성 후 화면 전환이 지연될 때 '생성'을 거듭 눌러 같은
  // 프로젝트가 여럿 생기던 실사용 결함 (렛츠 2026-08-30). 판정은 팀장의
  // 열람 범위(배정분만) 밖까지 봐야 하므로 admin으로 자사 전체를 확인한다.
  {
    const admin = createAdminClient();
    const practice = practiceFromUser(user);
    const [{ data: sameName }, { data: sameCode }] = await Promise.all([
      admin
        .from("projects")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_practice", practice)
        // 대소문자 차이 우회 방지(ilike). 취소 보관된 중복 정리 건과는
        // 같은 이름 재사용을 허용한다 (리뷰 4·5)
        .ilike("name", data.name)
        .eq("business_year", parseInt(data.businessYear, 10))
        .neq("status", "cancelled")
        .limit(1),
      data.code
        ? admin
            .from("projects")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("is_practice", practice)
            .eq("code", data.code)
            .neq("status", "cancelled")
            .limit(1)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    if ((sameName ?? []).length > 0) {
      return {
        ok: false,
        error:
          `같은 이름의 프로젝트가 ${data.businessYear}년에 이미 있습니다 (중복 생성 방지 규칙). ` +
          "이미 만들어졌을 수 있으니 프로젝트 목록을 새로고침해 확인하고, 새 프로젝트라면 이름을 바꿔 주세요.",
      };
    }
    if ((sameCode ?? []).length > 0) {
      return {
        ok: false,
        error:
          `같은 코드(${data.code})의 프로젝트가 이미 있습니다 (중복 생성 방지 규칙). ` +
          "프로젝트 목록을 확인하거나 다른 코드를 사용해 주세요.",
      };
    }
  }

  /**
   * id를 앱에서 생성하고 RETURNING(.select)을 쓰지 않는다.
   *
   * PostgreSQL은 RLS 테이블에서 INSERT … RETURNING의 반환 행에 SELECT 정책을
   * 적용한다. 이 테이블의 INSERT 정책은 role 기준(팀장 포함)인데 SELECT 정책은
   * grade 기준(이사 이상 or 배정자)이라, 팀장이 만들면 **삽입 자체가 되돌려졌다**
   * — 방금 만든 프로젝트에 배정 행이 있을 리 없기 때문이다. 렛츠에서 실제로
   * 터진 결함이다. 반환을 요구하지 않으면 SELECT 정책은 관여하지 않는다.
   */
  const projectId = randomUUID();
  const baseInsert = {
    id: projectId,
    tenant_id: tenantId,
    name: data.name,
    business_year: parseInt(data.businessYear, 10),
    client_name: data.clientName || null,
    host_org: data.hostOrg || null,
    category_id: data.categoryId || null,
    code: data.code || null,
    starts_on: data.startsOn || null,
    ends_on: data.endsOn || null,
    budget_amount: data.budgetAmount ? parseInt(data.budgetAmount, 10) : null,
    description: data.description || null,
    created_by: user.id,
  };
  // 계약 처리 구분(기획 2026-09-21) — 컬럼 미적용 환경(PGRST204)은 그 값만 빼고 다시 넣는다 (§14-10)
  let { error: projectError } = await supabase
    .from("projects")
    .insert({ ...baseInsert, contract_type: data.contractType || null });
  if (projectError && isMissingColumnError(projectError)) {
    ({ error: projectError } = await supabase.from("projects").insert(baseInsert));
  }

  if (projectError) {
    return {
      ok: false,
      error: await explainActionError(
        projectError.message,
        "프로젝트를 만들지 못했습니다."
      ),
    };
  }
  const project = { id: projectId };

  // 개설자 자동 PL 배정 (기획 확정 2026-08-30 — 배정 권한 계단화).
  // 대표·이사 아래(팀장)가 개설하면 본인이 이 프로젝트의 PL이 된다 — 그래야
  // 개설자가 PM 이하를 직접 지정해 일을 시작할 수 있다(계단: 대표·이사→PL,
  // PL→PM 이하). 대표·이사는 전사 열람·배정 권한이 있어 PL 슬롯을 점유하지
  // 않는다. PL 최소 레벨에 못 미치면(회사가 개설 문턱을 내린 경우) 건너뛴다.
  {
    const grade = gradeFromUser(user);
    if (isUserGrade(grade) && !canViewAllProjects(grade)) {
      const mins = await getAssignmentRoleMinGrades();
      // PL 직급에 못 미치면 그 직급으로 가능한 최고 역할(PM → 부PM → 담당)로
      // 넣는다 — 개설자가 팀에 없으면 기본정보·유형·필요인원 편집이 전부
      // "배정된 담당자만"에 걸려 막다른 길이 된다 (렛츠 보고 2026-09-05)
      const seatCandidates = (["pl", "pm", "deputy_pm", "member"] as const).filter(
        (r) => !roleMinGradeError(r, grade, mins)
      );
      // 배정 RLS는 계단 판정(기존 배정 기준)이라 첫 배정은 통과할 수 없다 —
      // 개설 게이트를 이미 통과한 서버 판단이므로 admin으로 심는다.
      // 주의: admin 경로에는 JWT가 없어 역할 최소레벨 트리거가 회사 조정값
      // 대신 기본값(PL=팀장·PM=대리·부PM=주임)으로 판정한다 — 회사가 문턱을
      // 내린 경우 앱 검사는 통과해도 트리거(check_violation)에 걸릴 수 있으니
      // 그때는 한 단계 아래 좌석으로 다시 시도한다 (리뷰 M5).
      const admin = createAdminClient();
      let seated = false;
      for (const seatRole of seatCandidates) {
        const { error: seatError } = await admin.from("project_assignments").insert({
          tenant_id: tenantId,
          project_id: project.id,
          user_id: user.id,
          assignment_role: seatRole,
          assigned_by: user.id,
        });
        if (!seatError) {
          seated = true;
          break;
        }
        if (seatError.code !== "23514") {
          console.warn("[project-create] auto seat assign failed:", seatError.code);
          break;
        }
      }
      if (!seated && seatCandidates.length > 0) {
        // 실패를 삼키면 이 기획이 고치려던 막다른 길(팀 구성 불가)이
        // 무증상으로 재현된다 (리뷰 2) — 프로젝트는 만들어졌으므로 성공을
        // 유지하되, 로그를 남긴다. 화면에는 배정 패널이 없는 상태로 보인다.
        console.warn("[project-create] auto seat assign: no seat accepted");
      }
    }
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
      return {
        ok: false,
        error: await explainActionError(
          stepsError.message,
          "프로젝트는 만들어졌지만 기본 스텝 구성에 실패했습니다. 프로젝트를 다시 만들지 마시고, 목록을 새로고침해 확인하세요."
        ),
      };
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

/**
 * 기존 프로젝트에 기본 21스텝 채우기.
 *
 * 스텝은 프로젝트 '생성 시'에만 복사됐다. 그래서 operations 모듈을 나중에 켠
 * 회사의 기존 프로젝트는 스텝이 0개인데 만들 방법이 없었고, 온보딩 안내는
 * "스텝을 생성하세요"라며 존재하지 않는 기능을 가리켰다(§1-2-8 위반 — 검수로
 * 확인). 이 액션이 그 잇는 경로다. 이미 스텝이 있으면 거부한다 — 중복 스텝은
 * 진행률을 망가뜨린다.
 */
export async function createDefaultSteps(
  projectId: string
): Promise<StepActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.operations) {
    return { ok: false, error: "행사 운영 기능을 사용하지 않는 회사입니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "스텝 생성 권한이 없습니다." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const { count } = await supabase
    .from("project_lifecycle_steps")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "이미 스텝이 있는 프로젝트입니다." };
  }

  const { error } = await supabase.from("project_lifecycle_steps").insert(
    DEFAULT_LIFECYCLE_STEPS.map((step) => ({
      tenant_id: tenantId,
      project_id: projectId,
      step_no: step.stepNo,
      step_type: step.stepType,
      title: step.title,
    }))
  );
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "기본 스텝을 만들지 못했습니다."),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "project.create_default_steps",
    resource_type: "project",
    resource_id: projectId,
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

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

/**
 * 참여율 배분 쓰기 주체 — 대표(ceo 직급) 또는 그 프로젝트의 PM(pm·pl_pm 배정) (기획 2026-09-21).
 * RLS(마이그레이션 0009 project_contributions_*)와 같은 기준. 탭도 이 둘에게만 보인다.
 */
async function requireContributionEditor(projectId: string): Promise<
  { ok: true; session: ProjectMgrSession } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (gradeFromUser(user) === "ceo") {
    return { ok: true, session: { userId: user.id, tenantId, role } };
  }
  const { data: mine } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mine?.assignment_role === "pm" || mine?.assignment_role === "pl_pm") {
    return { ok: true, session: { userId: user.id, tenantId, role } };
  }
  return {
    ok: false,
    error: "참여율 배분은 대표와 이 프로젝트의 PM만 입력·확정할 수 있습니다 (권한 규칙).",
  };
}

const contributionsSchema = z.object({
  projectId: z.string().uuid("프로젝트를 확인하세요."),
  // 가로 표의 열 (기획 지시 2026-09-21) — 열마다 사람 한 명 + %
  rows: z
    .array(
      z.object({
        slotKey: z.enum(CONTRIBUTION_SLOT_KEYS),
        roleLabel: z.string().trim().max(30, "열 이름은 30자 이내로 적어 주세요.").nullable(),
        userId: z.string().uuid(),
        percentage: z
          .number({ invalid_type_error: "기여도는 숫자여야 합니다." })
          .int("기여도는 정수여야 합니다.")
          .min(0, "기여도는 0 이상이어야 합니다.")
          .max(100, "기여도는 100 이하여야 합니다."),
      })
    )
    .max(CONTRIBUTION_SLOT_KEYS.length),
});
export type ContributionsInput = z.infer<typeof contributionsSchema>;

export type ProjectActionResult = { ok: true } | { ok: false; error: string };

const CONTRIBUTION_COLUMN_MISSING =
  "참여율 가로 표가 아직 이 서버에 준비되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션(0007) 적용을 요청해 주세요.";

/**
 * 참여율(기여도) 저장 — 가로 표의 열 단위 (관리자 이상). 자사 직원만, 완료/취소 프로젝트는 불가.
 * 확정된 뒤에는 '수정' 버튼으로 잠금을 풀기 전까지 저장을 거부한다 (규칙).
 * options.confirm = 저장과 함께 확정(합계 100%일 때만).
 */
export async function saveProjectContributions(
  input: ContributionsInput,
  options?: { confirm?: boolean }
): Promise<ProjectActionResult> {
  const parsed = contributionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const data = parsed.data;
  const auth = await requireContributionEditor(data.projectId);
  if (!auth.ok) return auth;
  const { session } = auth;
  const seenSlots = new Set<string>();
  for (const r of data.rows) {
    if (seenSlots.has(r.slotKey)) {
      return { ok: false, error: "같은 열이 두 번 들어왔습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
    }
    seenSlots.add(r.slotKey);
  }
  const supabase = createClient();

  const projectResult = await supabase
    .from("projects")
    .select("id, status, contribution_confirmed_at")
    .eq("id", data.projectId)
    .maybeSingle();
  if (isMissingColumnError(projectResult.error)) {
    return { ok: false, error: CONTRIBUTION_COLUMN_MISSING };
  }
  const project = projectResult.data;
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed" || project.status === "cancelled") {
    return { ok: false, error: "이미 종료·취소된 프로젝트는 기여도를 수정할 수 없습니다." };
  }
  if (project.contribution_confirmed_at) {
    return {
      ok: false,
      error: "참여율이 확정되어 있습니다 (규칙). 표 오른쪽 '수정' 버튼으로 잠금을 푼 뒤 고쳐 주세요.",
    };
  }
  const total = data.rows.reduce((s, r) => s + r.percentage, 0);
  if (options?.confirm && total !== 100) {
    return { ok: false, error: `합계가 정확히 100%여야 확정할 수 있습니다 (현재 ${total}%, 상태 미충족).` };
  }

  // 자사 직원 검증 (RLS로 자사 사용자만 조회됨)
  const userIds = Array.from(new Set(data.rows.map((r) => r.userId)));
  const { data: tenantUsers } = userIds.length
    ? await supabase.from("users").select("id, grade").in("id", userIds)
    : { data: [] };
  const validIds = new Set((tenantUsers ?? []).map((u) => u.id));
  if (userIds.some((id) => !validIds.has(id))) {
    return { ok: false, error: "자사 직원만 기여도 대상으로 지정할 수 있습니다." };
  }
  // 대표이사·상무이사 열은 설정의 직급(대표·이사)에서 자동으로 오는 고정 열이다 (기획 2026-09-21)
  const gradeById = new Map((tenantUsers ?? []).map((u) => [u.id, u.grade]));
  for (const r of data.rows) {
    const need = r.slotKey === "ceo" ? "ceo" : r.slotKey === "director" ? "director" : null;
    if (need && gradeById.get(r.userId) !== need) {
      return {
        ok: false,
        error: `${r.slotKey === "ceo" ? "대표이사" : "상무이사"} 열은 설정에서 ${need === "ceo" ? "대표" : "이사"} 직급인 사람만 설 수 있습니다 (규칙). 새로고침 후 다시 시도해 주세요.`,
      };
    }
  }

  // 표 전체를 다시 쓴다: 옛 행(slot_key null)과 빠진 열을 지우고 현재 열을 넣는다.
  // (project_id, slot_key) 유일 인덱스는 부분 인덱스(slot_key is not null)라
  // PostgREST upsert의 ON CONFLICT가 잡지 못한다 (마이그레이션 0007 검증에서 확인) —
  // upsert 대신 지우고 넣는다. 한 프로젝트 최대 8행이라 비용은 없다.
  const { error: clearError } = await supabase
    .from("project_contributions")
    .delete()
    .eq("project_id", data.projectId);
  if (clearError) {
    return {
      ok: false,
      error: await explainActionError(clearError.message, "기여도 저장에 실패했습니다. 다시 시도해 주세요."),
    };
  }
  if (data.rows.length > 0) {
    const { error: insertError } = await supabase.from("project_contributions").insert(
      data.rows.map((r) => ({
        tenant_id: session.tenantId,
        project_id: data.projectId,
        slot_key: r.slotKey,
        role_label: isExtraSlot(r.slotKey) ? r.roleLabel?.trim() || null : null,
        user_id: r.userId,
        percentage: r.percentage,
        created_by: session.userId,
      }))
    );
    if (insertError) {
      return {
        ok: false,
        error: isMissingColumnError(insertError)
          ? CONTRIBUTION_COLUMN_MISSING
          : await explainActionError(insertError.message, "기여도 저장에 실패했습니다. 다시 시도해 주세요."),
      };
    }
  }

  if (options?.confirm) {
    const { error: confirmError } = await supabase
      .from("projects")
      .update({
        contribution_confirmed_at: new Date().toISOString(),
        contribution_confirmed_by: session.userId,
      })
      .eq("id", data.projectId);
    if (confirmError) {
      return {
        ok: false,
        error: await explainActionError(confirmError.message, "참여율은 저장됐지만 확정 표시에 실패했습니다. 다시 시도해 주세요."),
      };
    }
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: options?.confirm ? "project_contributions.confirm" : "project_contributions.save",
    resource_type: "project",
    resource_id: data.projectId,
    after_data: { count: data.rows.length, total },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 참여율 확정 잠금 해제 — '수정' 버튼 (관리자 이상). 값은 그대로 두고 잠금만 푼다. */
export async function unlockProjectContributions(projectId: string): Promise<ProjectActionResult> {
  if (!z.string().uuid().safeParse(projectId).success) {
    return { ok: false, error: "프로젝트를 확인하세요." };
  }
  const auth = await requireContributionEditor(projectId);
  if (!auth.ok) return auth;
  const { session } = auth;
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed" || project.status === "cancelled") {
    return { ok: false, error: "이미 종료·취소된 프로젝트는 참여율을 수정할 수 없습니다 (상태 미충족)." };
  }
  const { error } = await supabase
    .from("projects")
    .update({ contribution_confirmed_at: null, contribution_confirmed_by: null })
    .eq("id", projectId);
  if (error) {
    return {
      ok: false,
      error: isMissingColumnError(error)
        ? CONTRIBUTION_COLUMN_MISSING
        : await explainActionError(error.message, "잠금 해제에 실패했습니다. 다시 시도해 주세요."),
    };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "project_contributions.unlock",
    resource_type: "project",
    resource_id: projectId,
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
  // 전결규정이 없으면 직급 체계로 위로 올린다(상신 자체를 막지 않는다).
  const matched = await matchApprovalRule("project", 0);
  const escalation = matched ? null : await buildGradeEscalationLine(session.userId, 0);
  if (!matched && !escalation) {
    return {
      ok: false,
      error:
        "결재할 상위직급자가 없습니다. 전결규정(유형: 프로젝트 품의)을 등록하거나 상위 직급 계정을 추가해 주세요.",
    };
  }
  const closingLine = matched ? matched.steps : escalation!.steps;

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
    appliedRuleId: matched?.ruleId ?? null,
    steps: closingLine,
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
