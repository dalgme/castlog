import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  canViewAllProjects,
  gradeLabel,
  gradeRank,
  isUserGrade,
} from "@/lib/auth/grades";
import { getExecFlags } from "@/lib/auth/exec-policy";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import {
  assignmentRoleRank,
  isAssignmentRole,
  isPlRole,
  isPmRole,
  type AssignmentRole,
} from "@/lib/integrations/assignment-roles";
import { getProjectDashboard } from "@/lib/integrations/project-dashboard";
import {
  getProjectEngagementState,
  buildEngagementPlanDraft,
  pickDispatchTargets,
  REDISPATCH_STAGES,
} from "@/lib/integrations/project-engagement";
import { getCanceledExpertByPositionCode } from "@/lib/integrations/urgent-cancellations";
import { DEFAULT_NOTICE_BODY } from "@/lib/integrations/notice-constants";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { isExtraFeatureEnabled } from "@/lib/features/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  PROJECT_STATUS_LABELS,
  STEP_STATUS_BOX_CLASS,
  STEP_STATUS_LABELS,
  STEP_TYPE_LABELS,
  autoStepStatus,
  type StepStatus,
  type StepType,
} from "@/lib/operations/steps";
import {
  deriveEngagementStage,
  type EngagementStage,
  type PlanStageInput,
} from "@/lib/integrations/engagement-stage";
import {
  buildPlanSnapshot,
  evaluatePlanGate,
  parsePlanSignatureCandidates,
  type SlotPlanState,
  planLineKey,
  type PlanSignatureLine,
} from "@/lib/integrations/engagement-plans";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { isPlanRelayEnabled } from "@/lib/approvals/relay";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EngagementDialog } from "@/components/integrations/engagement-dialog";
import { ProjectTodoTicker } from "@/components/projects/todo-ticker";

import { AttachmentPanel } from "./attachment-panel";

import { StepStatusButtons } from "./step-status-buttons";
import { type ExpertReviewTarget } from "./expert-review-form";
import { ProjectAssignmentPanel } from "./project-assignment-panel";
import { BasicInfoDialog } from "./basic-info-dialog";
import {
  ActionRequestPanel,
  type ActionRequestRow,
} from "./action-request-panel";
import { CreateStepsButton } from "./create-steps-button";
import { AttachEngagementsDialog } from "./attach-engagements-dialog";
import { SlotTable, type SlotRow } from "./slot-table";
import { ProjectCalendar } from "./project-calendar";
import { ConsultingPanel } from "./consulting-panel";
import { ProjectKindToggle } from "./project-kind-toggle";
import { BudgetPanel } from "./budget-panel";
import { ProjectDashboardCards } from "./project-dashboard-cards";
import {
  EngagementPlanPanel,
  type PlanPanelState,
} from "./engagement-plan-panel";
import { ProjectTabs, resolveProjectTab } from "./project-tabs";
import { getProjectSettlement } from "@/lib/integrations/project-settlement";
import {
  EngagementWorkbench,
  type UnlinkedEngagement,
} from "./engagement-workbench";
import {
  EngagementProgress,
  type ApprovedPlanRow,
  type ApprovedPlanSession,
  type ProgressRow,
  type SessionDispatchRow,
} from "./engagement-progress";
import {
  decidePlanFlow,
  type PlanFlow,
} from "@/lib/integrations/engagement-post-report";
import { ClosingTab } from "./closing-tab";
import { ProjectClosing } from "./project-closing";

export const metadata = { title: "프로젝트 상세" };

const STEP_TYPE_ORDER: StepType[] = [
  "preparation",
  "recruitment",
  "operation",
  "settlement",
  "reporting",
];

/**
 * 프로젝트 상세.
 *
 * 프로젝트 기본정보·PM/부PM 배정·세션·코드넘버·예산·종료 기여도는 **공통 기반**이다
 * (모듈 조합과 무관하게 항상 제공 — CLAUDE.md §1-2). 21스텝 라이프사이클만
 * operations 모듈 소속이라 그 섹션만 조건부로 그린다.
 * 스텝은 오케스트레이션 전용 — 각 단계의 업무 데이터는 전용 화면에서 다룬다.
 * 조회는 모바일 대응, 입력은 PC 최적화 (CLAUDE.md 10).
 */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string; projectId: string };
  searchParams: { tab?: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  // 프로젝트 기초는 공통 기반 — 모듈 게이트 없음 (21스텝 섹션만 아래에서 조건부)

  const role = roleFromUser(user);
  const grade = gradeFromUser(user);
  // 레벨 차등 + 회사별 문턱 조정 반영 — 서버 게이트와 같은 판정(getExecFlags).
  const exec = await getExecFlags(user, [
    "engagementRequest",
    "expertRecord",
    "planInput",
    "sessionNotice",
    "engagementCancel",
    "engagementWithdraw",
  ] as const);
  const canExecute = exec.engagementRequest;
  const canEvaluate = exec.expertRecord;

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="프로젝트 상세" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();

  // 신규 컬럼(주관·수행기관·D-Day·유형)은 42703 한정 폴백 (§14-10) —
  // 마이그레이션 전 환경에서 상세 전체가 404로 죽으면 안 된다 (리뷰 P2-3)
  const projectResult = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, status, starts_on, ends_on, description, closing_approval_id, closed_at, budget_amount, host_org, executor_org, dday_date, project_kind"
    )
    .eq("id", params.projectId)
    .maybeSingle();
  let project = projectResult.data;
  if (projectResult.error?.code === "42703") {
    const { data: legacyProject } = await supabase
      .from("projects")
      .select(
        "id, name, code, business_year, client_name, status, starts_on, ends_on, description, closing_approval_id, closed_at, budget_amount"
      )
      .eq("id", params.projectId)
      .maybeSingle();
    project = legacyProject
      ? {
          ...legacyProject,
          host_org: null,
          executor_org: null,
          dday_date: null,
          project_kind: "event",
        }
      : null;
  }

  if (!project) notFound();

  const modules = await getTenantModules();
  const expertsLite = await isExpertsLite();
  // '코드 없이 바로 섭외(예외)'는 기본 숨김 — 관리모드에서 회사별로 연다 (기획 17)
  const directEngagementOn = await isExtraFeatureEnabled("direct_engagement");

  const [
    { data: steps },
    engagementsResult,
    expertsResult,
    staffResult,
    contributionsResult,
    assignmentsResult,
    slotsResult,
  ] = await Promise.all([
      // 21스텝은 operations 모듈 소속 — 미사용 테넌트에는 스텝 자체가 없다
      modules.operations
        ? supabase
            .from("project_lifecycle_steps")
            .select(
              "id, step_no, step_type, title, status, due_on, completed_at, users (name)"
            )
            .eq("project_id", project.id)
            .order("step_no", { ascending: true })
        : Promise.resolve({ data: null }),
      // 섭외 연동은 experts 모듈 활성 시에만 (CLAUDE.md 1-2-6)
      modules.experts
        ? supabase
            .from("expert_engagements")
            .select(
              "id, expert_id, role_description, fee_amount, status, created_at, position_code, experts (name)"
            )
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null }),
      modules.experts
        ? supabase
            .from("expert_tenant_links")
            .select("expert_id, status, experts (id, name)")
            .eq("status", "active")
        : Promise.resolve({ data: null }),
      // 단계 23: 종료 기여도 대상 직원 + 기존 기여도
      supabase
        .from("users")
        .select("id, name, role, grade, department, is_active")
        .order("name", { ascending: true }),
      supabase
        .from("project_contributions")
        .select("user_id, percentage")
        .eq("project_id", project.id),
      // Phase A-1: 프로젝트 담당자 배정 (권한자 전용 표시)
      supabase
        .from("project_assignments")
        .select("user_id, assignment_role")
        .eq("project_id", project.id),
      // 세션별 정보 + 전문가 코드넘버 — 공통 기반(모듈 무관하게 항상 제공).
      // 수동 정렬(sort_order, 기획 2026-08-30)이 우선 — 없으면(null) 날짜·시간
      supabase
        .from("engagement_slots")
        .select(
          "id, slot_date, starts_time, ends_time, role_type, session_name, role_description, required_count, fee_amount, location_name, notes, sort_order, field_id, period_end_date"
        )
        .eq("project_id", project.id)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("slot_date", { ascending: true })
        .order("starts_time", { ascending: true }),
    ]);

  const stepRows = steps ?? [];
  const engagements = engagementsResult.data ?? [];
  const connectedExperts = (expertsResult.data ?? [])
    .map((l) => l.experts)
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => ({ id: e.id, name: e.name }));
  const done = stepRows.filter(
    (s) => s.status === "completed" || s.status === "skipped"
  ).length;

  // 정성 후기 — 이 프로젝트 건만 (전문가별 전체 이력은 전문가 화면에서 본다)
  const { data: reviewRows } = modules.experts
    ? await supabase
        .from("expert_reviews")
        .select("id, expert_id, body, created_at, author_user_id")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
    : { data: null };
  const staffNameById = new Map(
    (staffResult.data ?? []).map((u) => [u.id, u.name])
  );
  // 후기 대상 — 수락(계약 성립)된 섭외의 전문가. 사람 단위로 한 번씩 (중복 제거)
  const seenExpert = new Set<string>();
  const reviewTargets: ExpertReviewTarget[] = [];
  for (const engagement of engagements) {
    if (engagement.status !== "accepted") continue;
    if (seenExpert.has(engagement.expert_id)) continue;
    seenExpert.add(engagement.expert_id);
    reviewTargets.push({
      expertId: engagement.expert_id,
      name: engagement.experts?.name ?? "-",
      // 참여 세션은 슬롯을 읽은 뒤에 채운다 (아래 sessionsByExpert)
      sessions: [],
      reviews: (reviewRows ?? [])
        .filter((r) => r.expert_id === engagement.expert_id)
        .map((r) => ({
          id: r.id,
          body: r.body,
          createdAt: r.created_at,
          authorName: r.author_user_id
            ? (staffNameById.get(r.author_user_id) ?? null)
            : null,
        })),
    });
  }

  // 단계 23: 종료 기여도 + 종료 상태
  const staffOptions = (staffResult.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
  }));
  // 레벨 1~3 — 예산·마감·스텝 등 결정 성격의 도구
  const canManage = role === "org_admin" || role === "manager";
  // 배정 계단 (기획 확정 2026-08-30): 대표·이사 → PL 이하 전부,
  // PL(겸임) → PM 이하, PM(겸임) → 부PM 이하, 부PM → 담당.
  // 서버(assignment-actions)·RLS(can_assign_project_role)와 같은 표 —
  // assignableRoles(아래)가 그 판정이다.
  // 세션·코드넘버·후보 입력 (실무 입력선 — 기본 레벨 5, 회사 조정 반영)
  const canInput = exec.planInput;

  // 섭외계획 품의 게이트 (experts 모듈에서만 의미가 있다)
  let planPanel: PlanPanelState | null = null;
  /** 세션 → 계획 상태 (다중 계획). null = 게이트 없음(모듈 꺼짐) */
  let planSlotStates: Record<string, SlotPlanState> | null = null;
  let planApprovers: { id: string; name: string; gradeLabel: string }[] = [];
  // 상급자 릴레이(27번) 상태 — 픽커의 '비워 두면' 안내를 실제 동작과 일치시킨다
  let planRelayOn = false;
  if (modules.experts) {
    const [gate, snapshot] = await Promise.all([
      evaluatePlanGate(project.id, modules.approvals),
      buildPlanSnapshot(project.id),
    ]);
    // 다중 계획 (기획 지시 2026-09-05): 살아 있는 계획을 전부 싣는다
    const { data: panelSlots } = await supabase
      .from("engagement_slots")
      .select("id, slot_date, session_name")
      .eq("project_id", project.id);
    const slotLabelForPanel = new Map(
      (panelSlots ?? []).map((sr) => [
        sr.id,
        `${sr.slot_date}${sr.session_name ? ` ${sr.session_name}` : ""}`,
      ])
    );
    // 각 승인 계획에 대한 최근 변경 품의 반려 사유 (E2E 검수 P1-1)
    const rejectionByParent = new Map<string, string>();
    if (gate.required && gate.plans.some((v) => v.state === "approved" || v.state === "changed")) {
      const { data: rejectedChildren } = await supabase
        .from("engagement_plans")
        .select("parent_plan_id, last_rejection_note, updated_at")
        .eq("project_id", project.id)
        .eq("status", "rejected")
        .not("parent_plan_id", "is", null)
        .order("updated_at", { ascending: false });
      for (const r of rejectedChildren ?? []) {
        if (r.parent_plan_id && r.last_rejection_note && !rejectionByParent.has(r.parent_plan_id)) {
          rejectionByParent.set(r.parent_plan_id, r.last_rejection_note);
        }
      }
    }
    planPanel = {
      required: gate.required,
      allowed: gate.required ? gate.allowed : true,
      state: gate.required ? gate.state : "module_off",
      message: gate.required ? gate.message : "",
      coveredSlotIds: gate.required ? gate.coveredSlotIds : null,
      plans: gate.required
        ? gate.plans.map((v) => ({
            id: v.plan.id,
            revision: v.plan.revision,
            state: v.state,
            approvalId: v.plan.approvalId,
            plannedAmount: v.plan.plannedAmount,
            positionCount: v.plan.positionCount,
            slotCount: v.plan.slotCount,
            coveredSlotIds: v.coveredSlotIds,
            sessionLabels: (v.coveredSlotIds ?? []).map(
              (id) => slotLabelForPanel.get(id) ?? "(삭제된 세션)"
            ),
            message: v.message,
            postReport: v.plan.flow === "post_report",
            lastChangeRejection:
              v.state === "approved" || v.state === "changed"
                ? (rejectionByParent.get(v.plan.id) ?? null)
                : null,
          }))
        : [],
      uncoveredSlotIds: gate.required ? gate.uncoveredSlotIds : [],
      currentPlannedAmount: snapshot.plannedAmount,
      currentPositionCount: snapshot.positionCount,
      currentSlotCount: snapshot.slotCount,
    };
    planSlotStates = gate.required ? gate.slotStates : null;

    // 전결규정이 없을 때 직접 지정할 결재자 후보 (본인 제외 활성 직원)
    // 결재라인 후보 (기획 개정 2026-08-30 — 30번): 상신자보다 **높은 직급**만.
    // 상무이사·대표는 어차피 고정(필수)으로 라인 끝에 붙으므로 후보에서 뺀다.
    const myRank = isUserGrade(grade) ? gradeRank(grade) : 0;
    planApprovers = (staffResult.data ?? [])
      .filter((u) => u.is_active && u.id !== user?.id)
      .filter(
        (u) =>
          isUserGrade(u.grade) &&
          gradeRank(u.grade) > myRank &&
          u.grade !== "director" &&
          u.grade !== "ceo"
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        gradeLabel: gradeLabel(u.grade),
      }));

    if (modules.approvals) {
      planRelayOn = await isPlanRelayEnabled();
    }
  }
  const staffForAssign = (staffResult.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    gradeLabel: gradeLabel(u.grade),
    department: u.department,
  }));
  const staffById = new Map(staffForAssign.map((s) => [s.id, s]));
  const assignedMembers = (assignmentsResult.data ?? [])
    .map((a) => {
      const u = staffById.get(a.user_id);
      return {
        userId: a.user_id,
        name: u?.name ?? "-",
        gradeLabel: u?.gradeLabel ?? "-",
        assignmentRole: isAssignmentRole(a.assignment_role)
          ? a.assignment_role
          : ("member" as const),
      };
    })
    .sort(
      (a, b) =>
        assignmentRoleRank(a.assignmentRole) -
        assignmentRoleRank(b.assignmentRole)
    );
  // 부PM 실행 → PM 승인 관계 (공통 기반 — approvals 모듈과 무관)
  const myAssignmentRole =
    assignedMembers.find((m) => m.userId === user?.id)?.assignmentRole ?? null;

  // 배정 계단 — 내가 지정할 수 있는 역할 (서버·RLS와 동일 표)
  const assignableRoles: AssignmentRole[] = canViewAllProjects(grade)
    ? ["pl", "pl_pm", "pm", "deputy_pm", "member"]
    : myAssignmentRole === "pl" || myAssignmentRole === "pl_pm"
      ? ["pm", "deputy_pm", "member"]
      : myAssignmentRole === "pm"
        ? ["deputy_pm", "member"]
        : myAssignmentRole === "deputy_pm"
          ? ["member"]
          : [];
  const { data: actionRequestRecords } = await supabase
    .from("project_action_requests")
    .select(
      "id, action_type, target_id, request_note, status, requested_by, decided_by, decision_note, consumed_at, created_at"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(50);
  // 대상 지정형 요청은 무엇에 대한 승인인지 사람이 읽을 수 있어야 한다 (검수 A1) —
  // target_id(UUID)만으로는 PM이 뭘 승인하는지 모른 채 실행 1회분을 발급하게 된다.
  const targetLabelById = new Map<string, string>();
  {
    const rows = actionRequestRecords ?? [];
    const positionIds = rows
      .filter((r) => r.target_id && r.action_type === "engagement.request")
      .map((r) => r.target_id as string);
    const engagementIds = rows
      .filter(
        (r) =>
          r.target_id &&
          ["engagement.cancel", "engagement.manual_accept", "engagement.remind"].includes(
            r.action_type
          )
      )
      .map((r) => r.target_id as string);
    const slotIds = rows
      .filter((r) => r.target_id && r.action_type === "engagement.session_sms")
      .map((r) => r.target_id as string);
    if (positionIds.length > 0) {
      const { data } = await supabase
        .from("engagement_slot_positions")
        .select("id, code")
        .in("id", positionIds);
      for (const p of data ?? []) targetLabelById.set(p.id, `코드넘버 ${p.code}`);
    }
    if (engagementIds.length > 0) {
      const { data } = await supabase
        .from("expert_engagements")
        .select("id, starts_on, experts (name)")
        .in("id", engagementIds);
      for (const e of data ?? []) {
        targetLabelById.set(
          e.id,
          [e.experts?.name, e.starts_on].filter(Boolean).join(" · ")
        );
      }
    }
    if (slotIds.length > 0) {
      const { data } = await supabase
        .from("engagement_slots")
        .select("id, session_name, slot_date")
        .in("id", slotIds);
      for (const s of data ?? []) {
        targetLabelById.set(
          s.id,
          [s.slot_date, s.session_name].filter(Boolean).join(" · ")
        );
      }
    }
  }
  const actionRequests: ActionRequestRow[] = (actionRequestRecords ?? []).map(
    (r) => ({
      id: r.id,
      actionType: r.action_type,
      targetId: r.target_id,
      targetLabel: r.target_id
        ? (targetLabelById.get(r.target_id) ?? null)
        : r.action_type === "engagement.request"
          ? "프로젝트 전체 일괄 발송 (배정된 전원)"
          : null,
      requestNote: r.request_note,
      status: r.status,
      requesterName: staffById.get(r.requested_by)?.name ?? "(직원)",
      deciderName: r.decided_by
        ? staffById.get(r.decided_by)?.name ?? "(직원)"
        : null,
      decisionNote: r.decision_note,
      consumedAt: r.consumed_at,
      createdAt: r.created_at,
    })
  );
  // 승인 주체는 PM(겸임 포함)과 PL(총괄). 대표·이사는 전사 열람 권한과 함께 승인도 할 수 있다.
  const canDecideActions =
    isPmRole(myAssignmentRole) ||
    myAssignmentRole === "pl" ||
    canViewAllProjects(gradeFromUser(user));
  const showActionRequests =
    actionRequests.length > 0 ||
    myAssignmentRole === "deputy_pm" ||
    canDecideActions;

  // PL·PM 겸임(pl_pm)은 양쪽 자리에 모두 표기
  const plName =
    assignedMembers.find((m) => isPlRole(m.assignmentRole))?.name ?? null;
  const pmName =
    assignedMembers.find((m) => isPmRole(m.assignmentRole))?.name ?? null;
  const deputyPmNames = assignedMembers
    .filter((m) => m.assignmentRole === "deputy_pm")
    .map((m) => m.name);

  // Phase B-1: 슬롯별 넘버링코드 인원 조회.
  // 부재 폴백 (§14-10): sort_order 컬럼 미적용 환경(42703)에서만 기존 정렬로
  // 재시도 — 세션 목록이 통째로 비지 않게
  let slotRecords = slotsResult.data ?? [];
  if (slotsResult.error?.code === "42703") {
    const { data: legacySlots } = await supabase
      .from("engagement_slots")
      .select(
        "id, slot_date, starts_time, ends_time, role_type, session_name, role_description, required_count, fee_amount, location_name, notes"
      )
      .eq("project_id", project.id)
      .order("slot_date", { ascending: true })
      .order("starts_time", { ascending: true });
    slotRecords = (legacySlots ?? []).map((s) => ({
      ...s,
      sort_order: null,
      field_id: null,
      period_end_date: null,
    }));
  }
  const slotIds = slotRecords.map((s) => s.id);
  const { data: positionRecords } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select(
          "id, slot_id, position_no, code, status, expert_id, engagement_id, assigned_expert_id, rank, expected_fee"
        )
        .in("slot_id", slotIds)
        .order("position_no", { ascending: true })
    : { data: [] };
  const positionExpertIds = Array.from(
    new Set(
      (positionRecords ?? [])
        .flatMap((p) => [p.expert_id, p.assigned_expert_id])
        .filter(Boolean)
    )
  ) as string[];
  const { data: positionExperts } = positionExpertIds.length
    ? await supabase.from("experts").select("id, name").in("id", positionExpertIds)
    : { data: [] };
  const expertNameById = new Map(
    (positionExperts ?? []).map((e) => [e.id, e.name])
  );
  // 세션 안내문자 — 템플릿(테넌트 공용) + 세션별 발송 내역
  const [{ data: noticeTemplateRows }, { data: noticeRows }] = modules.experts
    ? await Promise.all([
        supabase
          .from("session_notice_templates")
          .select("id, name, body")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        slotIds.length
          ? supabase
              .from("session_notices")
              .select(
                "id, slot_id, status, scheduled_at, sent_at, recipient_count, sent_count, failed_count, last_error"
              )
              .in("slot_id", slotIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: null }),
      ])
    : [{ data: null }, { data: null }];

  // 긴급 취소 — 재섭외 대상 자리 표시용. (상단 흐름 전광판은 '지금 할 일'로
  // 대체 — 긴급 취소는 정적 긴급 배너가 별도로 알린다. 기획 확정 2026-08-23)
  const canceledByCode = modules.experts
    ? await getCanceledExpertByPositionCode(project.id)
    : ({} as Record<string, string>);

  // 세션 분야 마스터 (35번) + 멘티 정보 (34번) — 미적용 환경은 빈 목록 폴백
  let sessionFieldOptions: { id: string; name: string }[] = [];
  {
    const { data: fieldRows, error: fieldError } = await supabase
      .from("tenant_session_fields")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (fieldError && fieldError.code !== "42P01") {
      console.error("session fields query failed:", fieldError.message);
    }
    if (!fieldError) sessionFieldOptions = fieldRows ?? [];
  }
  const sessionFieldNameById = new Map(
    sessionFieldOptions.map((f) => [f.id, f.name])
  );
  let menteesBySlot = new Map<
    string,
    {
      id: string;
      orgName: string;
      positionTitle: string | null;
      name: string;
      itemName: string | null;
      menteeType: string | null;
    }[]
  >();
  if (project.project_kind === "consulting" && slotRecords.length > 0) {
    const { data: menteeRows, error: menteeError } = await supabase
      .from("slot_mentees")
      .select("id, slot_id, org_name, position_title, name, item_name, mentee_type, sort_order")
      .in("slot_id", slotRecords.map((sl) => sl.id))
      .order("sort_order", { ascending: true });
    if (menteeError && menteeError.code !== "42P01") {
      console.error("slot mentees query failed:", menteeError.message);
    }
    if (!menteeError) {
      menteesBySlot = new Map();
      for (const m of menteeRows ?? []) {
        const list = menteesBySlot.get(m.slot_id) ?? [];
        list.push({
          id: m.id,
          orgName: m.org_name,
          positionTitle: m.position_title,
          name: m.name,
          itemName: m.item_name,
          menteeType: m.mentee_type,
        });
        menteesBySlot.set(m.slot_id, list);
      }
    }
  }

  // 캘린더 일정표의 일자 스캐폴드 (29번) — 테이블 미적용(42P01)만 빈 목록 폴백.
  // 다른 에러를 삼키면 만들어 둔 빈 날짜가 조용히 사라져 보인다 (§14-10, 리뷰 P2-3)
  let calendarDays: string[] = [];
  {
    const { data: dayRows, error: dayError } = await supabase
      .from("project_calendar_days")
      .select("day")
      .eq("project_id", project.id)
      .order("day", { ascending: true });
    if (dayError && dayError.code !== "42P01") {
      console.error("calendar days query failed:", dayError.message);
    }
    if (!dayError) calendarDays = (dayRows ?? []).map((d) => d.day);
  }

  // 거절·만료로 다시 비게 된 자리 — 자리는 open으로 돌아가고 포인터가 지워져
  // "누가 거절했는지"가 자리에 남지 않는다(긴급 취소와 같은 구조). 섭외 건의
  // position_code로 되짚어 자리 행에 표시한다 (E2E 검수 P2-8)
  const priorOutcomeByCode: Record<
    string,
    {
      engagementId: string;
      expertId: string;
      expertName: string;
      outcome: "declined" | "expired";
    }
  > = {};
  for (const e of engagements) {
    if (e.status !== "declined" && e.status !== "expired") continue;
    if (!e.position_code || priorOutcomeByCode[e.position_code]) continue; // 최신순 — 가장 최근만
    priorOutcomeByCode[e.position_code] = {
      engagementId: e.id,
      expertId: e.expert_id,
      expertName: e.experts?.name ?? "전문가",
      outcome: e.status,
    };
  }
  // 자리 행에 붙는 조건: 새 요청이 아직 없고(engagement_id 없음), 자리가 비었거나
  // 그 전문가가 그대로 배정돼 있을 때. 다른 전문가가 새로 배정됐으면 이전
  // 거절 표시는 오해만 낳는다 (리뷰 M3)
  const priorOutcomeFor = (p: {
    code: string;
    status: string;
    engagement_id: string | null;
    assigned_expert_id: string | null;
  }) => {
    if (p.engagement_id) return null;
    const prior = priorOutcomeByCode[p.code];
    if (!prior) return null;
    if (p.status === "open") return prior;
    if (p.status === "assigned" && p.assigned_expert_id === prior.expertId) {
      return prior;
    }
    return null;
  };

  const slotRows: SlotRow[] = slotRecords.map((s) => ({
    id: s.id,
    slotDate: s.slot_date,
    fieldId: s.field_id,
    periodEndDate: s.period_end_date,
    startsTime: s.starts_time,
    endsTime: s.ends_time,
    roleType: s.role_type,
    sessionName: s.session_name,
    roleDescription: s.role_description,
    requiredCount: s.required_count,
    feeAmount: s.fee_amount,
    locationName: s.location_name,
    notes: s.notes,
    positions: (positionRecords ?? [])
      .filter((p) => p.slot_id === s.id)
      .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no))
      .map((p) => ({
        id: p.id,
        code: p.code,
        positionNo: p.position_no,
        rank: p.rank ?? p.position_no,
        expectedFee: p.expected_fee,
        status: p.status,
        expertName: p.expert_id ? (expertNameById.get(p.expert_id) ?? null) : null,
        engagementId: p.engagement_id,
        canceledExpertName:
          p.status === "open" ? (canceledByCode[p.code] ?? null) : null,
        priorOutcome: (() => {
          const prior = priorOutcomeFor(p);
          return prior
            ? { expertName: prior.expertName, outcome: prior.outcome }
            : null;
        })(),
        assignedExpertName: p.assigned_expert_id
          ? (expertNameById.get(p.assigned_expert_id) ?? null)
          : null,
      })),
    notice: {
      // 안내문자 대상 = 이 세션에 섭외가 확정된 전문가 (요청중·미섭외 제외)
      targets: (positionRecords ?? [])
        .filter((p) => p.slot_id === s.id && p.status === "filled" && p.expert_id)
        .map((p) => ({
          name: expertNameById.get(p.expert_id as string) ?? "-",
          code: p.code,
        })),
      notices: (noticeRows ?? [])
        .filter((n) => n.slot_id === s.id)
        .map((n) => ({
          id: n.id,
          status: n.status,
          scheduledAt: n.scheduled_at,
          sentAt: n.sent_at,
          recipientCount: n.recipient_count,
          sentCount: n.sent_count,
          failedCount: n.failed_count,
          lastError: n.last_error,
        })),
    },
  }));
  // 전문가별 참여 세션 — 마감 평가에서 "무슨 일을 한 분인지"가 먼저 떠올라야 한다
  const sessionsByExpert = new Map<string, string[]>();
  for (const slot of slotRecords) {
    const label =
      slot.session_name ?? slot.role_description ?? `${slot.slot_date} 세션`;
    for (const position of positionRecords ?? []) {
      if (position.slot_id !== slot.id || !position.expert_id) continue;
      const list = sessionsByExpert.get(position.expert_id) ?? [];
      if (!list.includes(label)) list.push(label);
      sessionsByExpert.set(position.expert_id, list);
    }
  }
  for (const row of reviewTargets) {
    row.sessions = sessionsByExpert.get(row.expertId) ?? [];
  }

  const contributionInitial: Record<string, number> = {};
  for (const c of contributionsResult.data ?? []) {
    contributionInitial[c.user_id] = c.percentage;
  }
  // 프로젝트에 연결되지 않은 섭외 건 — 있을 때만 '붙이기' 도구를 노출한다.
  // (프로젝트 없이 섭외해 온 테넌트가 프로젝트를 쓰기 시작할 때의 정리 경로)
  const { count: unlinkedCount } =
    modules.experts && canManage
      ? await supabase
          .from("expert_engagements")
          .select("id", { count: "exact", head: true })
          .is("project_id", null)
          .in("status", ["requested", "accepted"])
      : { count: 0 };

  // 예산 대비 섭외비 집계 (Phase C-3)
  const plannedCost = slotRecords.reduce(
    (sum, s) => sum + (s.fee_amount ?? 0) * s.required_count,
    0
  );
  const requestedCost = engagements
    .filter((e) => e.status === "requested")
    .reduce((sum, e) => sum + (e.fee_amount ?? 0), 0);
  const confirmedCost = engagements
    .filter((e) => e.status === "accepted")
    .reduce((sum, e) => sum + (e.fee_amount ?? 0), 0);

  const noticeTemplates = (noticeTemplateRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    body: t.body,
  }));

  const dashboard = await getProjectDashboard(project.id, {
    experts: modules.experts,
    approvals: modules.approvals,
  });

  const isClosed = project.status === "completed";
  const closingInProgress =
    project.closing_approval_id !== null && !isClosed;

  // '수락서 생성 및 확정' 탭 — 확정(수락)된 섭외 건의 수락서 진행 상태
  const acceptedEngagements = engagements.filter((e) => e.status === "accepted");
  const { data: acceptanceRecords } =
    modules.experts && acceptedEngagements.length
      ? await supabase
          .from("engagement_acceptances")
          .select(
            "id, engagement_id, letter_no, status, sent_at, signed_at, confirmed_at"
          )
          .in(
            "engagement_id",
            acceptedEngagements.map((e) => e.id)
          )
      : { data: null };
  const acceptanceByEngagement = new Map(
    (acceptanceRecords ?? []).map((a) => [a.engagement_id, a])
  );

  // 코드넘버 한 자리의 '지금 어디까지 왔나' — 계획품의·섭외·수락서를 합쳐 판정한다.
  // 판정 규칙은 lib/integrations/engagement-stage.ts 한 곳에 있다.
  const engagementStatusById = new Map(engagements.map((e) => [e.id, e.status]));
  const planState: PlanStageInput = planPanel
    ? planPanel.required
      ? planPanel.state
      : "module_off"
    : "module_off";
  // 세션 단위 판정 (다중 계획 — 2026-09-05): 세션마다 어느 계획에 담겨 어디까지
  // 왔는지가 다르다. 프로젝트 단계로 뭉뚱그리면 세션 하나를 올린 순간 나머지
  // 전부가 '품의 중'으로 잠긴다 (렛츠 보고).
  const slotPlanState = (slotId: string): PlanStageInput =>
    planSlotStates ? (planSlotStates[slotId] ?? "none") : planState;
  const stageByPosition: Record<string, EngagementStage> = {};
  for (const slot of slotRows) {
    for (const position of slot.positions) {
      const engagementStatus = position.engagementId
        ? (engagementStatusById.get(position.engagementId) ?? null)
        : null;
      const acceptanceStatus = position.engagementId
        ? (acceptanceByEngagement.get(position.engagementId)?.status ?? null)
        : null;
      stageByPosition[position.id] = deriveEngagementStage({
        positionStatus: position.status,
        engagementStatus,
        acceptanceStatus,
        planState: slotPlanState(slot.id),
      });
    }
  }
  // 편집 개방 여부 — 살아 있는 계획(결재 중·승인)에 담기지 않은 세션만.
  // 수락서 송부 뒤·종료·정산 단계에 새 세션을 열어 두면 갈 곳이 없다 (리뷰 M1)
  const slotPlanStatesForWorkbench: Record<string, SlotPlanState> = {};
  for (const slot of slotRows) {
    const st = slotPlanState(slot.id);
    slotPlanStatesForWorkbench[slot.id] = st === "module_off" ? "none" : st;
  }

  // 코드넘버에 붙지 않은 섭외 건 — 세션 아래 자리가 없으므로 작업대 끝에 모은다
  const linkedEngagementIds = new Set(
    slotRows.flatMap((slot) =>
      slot.positions
        .map((p) => p.engagementId)
        .filter((id): id is string => id !== null)
    )
  );
  // 자리 행에 '이전 후보'로 실제 표시된 거절·만료 건만 여기서 뺀다 — 여기 다시
  // 실으면 같은 건이 두 곳에 보이고, 표시되지 않은 옛 건을 빼면 아무 데도
  // 안 보인다 (E2E 검수 P2-8, 리뷰 M4)
  const shownAsPriorOutcome = new Set(
    (positionRecords ?? [])
      .map((p) => priorOutcomeFor(p)?.engagementId ?? null)
      .filter((id): id is string => id !== null)
  );
  const unlinkedEngagements: UnlinkedEngagement[] = engagements
    .filter((e) => !linkedEngagementIds.has(e.id))
    .filter((e) => !shownAsPriorOutcome.has(e.id))
    .map((e) => ({
      id: e.id,
      expertName: e.experts?.name ?? "-",
      roleDescription: e.role_description,
      feeAmount: e.fee_amount,
      status: e.status,
      stage: deriveEngagementStage({
        positionStatus: "requested",
        engagementStatus: e.status,
        acceptanceStatus: acceptanceByEngagement.get(e.id)?.status ?? null,
        planState,
      }),
    }));


  // 섭외요청 첨부 (공통/개별)
  const { data: attachmentRows } = modules.experts
    ? await supabase
        .from("project_engagement_attachments")
        .select("id, scope, expert_id, file_name, purpose")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true })
    : { data: null };

  // 프로젝트 단위 진행 단계 + 품의서 미리보기 — 버튼 활성 조건의 단일 근거
  const [engagementState, planDraft] = modules.experts
    ? await Promise.all([
        // 커버리지를 넘겨 재발송 버튼 건수가 서버 대상과 일치하게 (리뷰 P2-2)
        getProjectEngagementState(project.id, {
          coveredSlotIds: planPanel?.coveredSlotIds ?? null,
        }),
        buildEngagementPlanDraft(project.id),
      ])
    : [null, null];
  // 사후보고 모드(38번) — 버튼 초기 라벨은 전체 계획 금액 기준. 대화상자에서
  // 세션을 고르면 previewPlanFlow가 선택 금액으로 다시 판정한다 (리뷰 P1-1).
  // 섭외후보 탭에서만 필요하므로 그때만 조회 (리뷰 P3-7)
  const planFlow: PlanFlow =
    modules.experts &&
    modules.approvals &&
    resolveProjectTab(searchParams.tab, modules.experts) === "experts"
      ? await decidePlanFlow({
          amount: planDraft?.amount ?? 0,
          requesterGrade: grade,
        })
      : { mode: "pre_approval", reason: null };

  // 21스텝 자동 판정 컨텍스트 — 섭외 단계·예산·종료 여부 (표시 전용)
  const autoCtx = {
    stage: engagementState?.stage ?? "assigning",
    hasBudget: project.budget_amount !== null,
    closed: project.closed_at !== null,
  };

  // 첨부 대상 후보 — 이 프로젝트에 배정·섭외된 전문가 (id로 다룬다)
  const assignedExpertOptions = Array.from(
    new Set(
      (positionRecords ?? [])
        .flatMap((p) => [p.assigned_expert_id, p.expert_id])
        .filter((id): id is string => id !== null)
    )
  ).map((id) => ({ id, name: expertNameById.get(id) ?? "전문가" }));

  // 종료·지급 품의 — 마감 탭에서만 쓰지만 단계 배너는 늘 필요하다
  const [settlement, canReviewSettlementDoc] = await Promise.all([
    getProjectSettlement(project.id),
    canManagePayments(),
  ]);

  const tab = resolveProjectTab(searchParams.tab, modules.experts);

  // 승인 목록 및 섭외 진행 탭 (37번) — 계획 리비전 목록 + 코드별 진행 현황.
  // 그 탭에서만 쓰므로 그때만 읽는다.
  let approvedPlans: ApprovedPlanRow[] = [];
  const progressRows: ProgressRow[] = [];
  const sessionDispatch: SessionDispatchRow[] = [];
  // 이 탭의 세션 표기는 한 가지로 — 진행 현황·승인 목록·세션별 송신 카드 공통
  const slotLabelById = new Map(
    slotRows.map((s) => [
      s.id,
      `${s.slotDate}${s.periodEndDate && s.periodEndDate !== s.slotDate ? `~${s.periodEndDate}` : ""}${
        s.sessionName ? ` ${s.sessionName}` : ""
      }`,
    ])
  );
  if (tab === "engage" && modules.experts) {
    if (modules.approvals) {
      const { data: planRows } = await supabase
        .from("engagement_plans")
        .select(
          "id, revision, status, approval_id, slot_count, position_count, planned_amount, note, last_rejection_note, submitted_at, approved_at, flow, feedback_note, plan_signature"
        )
        .eq("project_id", project.id)
        // 반려된 계획은 draft로 되돌아간다(재상신용) — 반려 사유가 있으면
        // 이력으로 보여 준다. 한 번도 안 올린 순수 draft만 뺀다
        .or("status.neq.draft,last_rejection_note.not.is.null")
        .order("revision", { ascending: false })
        .limit(30);
      const planIds = (planRows ?? []).map((p) => p.id);
      type PlanLineRow = {
        plan_id: string;
        slot_id: string | null;
        slot_date: string;
        starts_time: string | null;
        ends_time: string | null;
        role_type: string;
        role_description: string | null;
        required_count: number;
        location_name: string | null;
        subtotal: number;
      };
      const { data: lineRows } = planIds.length
        ? await supabase
            .from("engagement_plan_lines")
            .select(
              "plan_id, slot_id, slot_date, starts_time, ends_time, role_type, role_description, required_count, location_name, subtotal"
            )
            .in("plan_id", planIds)
            .order("slot_date", { ascending: true })
        : { data: [] as PlanLineRow[] };
      const slotIdsByPlan = new Map<string, Set<string>>();
      const linesByPlan = new Map<string, PlanLineRow[]>();
      for (const l of lineRows ?? []) {
        const list = linesByPlan.get(l.plan_id) ?? [];
        list.push(l);
        linesByPlan.set(l.plan_id, list);
        if (!l.slot_id) continue;
        const set = slotIdsByPlan.get(l.plan_id) ?? new Set<string>();
        set.add(l.slot_id);
        slotIdsByPlan.set(l.plan_id, set);
      }
      // 상신·승인 시점의 섭외 대상(코드·전문가·예정가)은 지문에 있다 —
      // 현재 배정이 아니라 결재된 금액을 보여 준다 (핫픽스 2026-09-05).
      // 명세 행과는 지문 line 열쇠(일자·시간·역할·인원·소계)로 잇는다 —
      // 현재 자리(코드)로 되짚으면 그 뒤 지운 자리의 전문가가 사라져 소계와
      // 어긋난다 (리뷰 M2)
      const signatureLinesByPlan = new Map(
        (planRows ?? []).map((p) => [
          p.id,
          parsePlanSignatureCandidates(p.plan_signature),
        ])
      );
      const signatureExpertIds = Array.from(
        new Set(
          Array.from(signatureLinesByPlan.values())
            .flat()
            .flatMap((line) => line.candidates.map((c) => c.expertId))
            .filter((id): id is string => id !== null && !expertNameById.has(id))
        )
      );
      // 승인 뒤 연결이 끊긴 전문가는 RLS로 안 보일 수 있다 → "전문가" 폴백
      const { data: signatureExperts } = signatureExpertIds.length
        ? await supabase
            .from("experts")
            .select("id, name")
            .in("id", signatureExpertIds)
        : { data: [] as { id: string; name: string }[] };
      const signatureNameById = new Map(
        (signatureExperts ?? []).map((e) => [e.id, e.name])
      );
      const expertLabel = (id: string | null) =>
        id
          ? (expertNameById.get(id) ?? signatureNameById.get(id) ?? "전문가")
          : "미배정";
      const periodEndBySlot = new Map(
        slotRows.map((s) => [s.id, s.periodEndDate])
      );
      const sessionsOf = (planId: string): ApprovedPlanSession[] => {
        // 같은 열쇠의 line이 둘이면(같은 날·시간·역할·인원·소계) 순서대로 소비
        const pool = new Map<string, PlanSignatureLine[]>();
        for (const line of signatureLinesByPlan.get(planId) ?? []) {
          const list = pool.get(line.key) ?? [];
          list.push(line);
          pool.set(line.key, list);
        }
        return (linesByPlan.get(planId) ?? []).map((l) => {
          const matched = pool.get(planLineKey(l))?.shift();
          return {
            slotId: l.slot_id,
            label:
              (l.slot_id ? slotLabelById.get(l.slot_id) : null) ??
              `${l.slot_date} (삭제된 세션)`,
            schedule: formatEventSchedule(
              l.slot_date,
              l.slot_id ? (periodEndBySlot.get(l.slot_id) ?? null) : null,
              l.starts_time,
              l.ends_time
            ),
            roleDescription: l.role_description,
            locationName: l.location_name,
            requiredCount: l.required_count,
            subtotal: l.subtotal,
            experts: (matched?.candidates ?? [])
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((c) => ({
                code: c.code,
                name: expertLabel(c.expertId),
                fee: c.fee,
              })),
          };
        });
      };
      // 결재 문서 상태 — 사후보고(38번)의 확인 상태와, 상신 취소된 계획
      // (superseded + 문서 canceled)의 구분은 계획이 아니라 문서에 있다
      const planApprovalIds = (planRows ?? [])
        .map((p) => p.approval_id)
        .filter((id): id is string => id !== null);
      const { data: approvalRows } = planApprovalIds.length
        ? await supabase
            .from("approvals")
            .select("id, status")
            .in("id", planApprovalIds)
        : { data: [] as { id: string; status: string }[] };
      const reportStatusById = new Map(
        (approvalRows ?? []).map((r) => [r.id, r.status])
      );
      approvedPlans = (planRows ?? []).map((p) => ({
        id: p.id,
        revision: p.revision,
        status:
          p.status === "draft" && p.last_rejection_note
            ? "rejected"
            : p.status === "superseded" &&
                p.approval_id &&
                reportStatusById.get(p.approval_id) === "canceled"
              ? "withdrawn"
              : p.status,
        approvalId: p.approval_id,
        slotCount: p.slot_count,
        positionCount: p.position_count,
        plannedAmount: p.planned_amount,
        submittedAt: p.submitted_at,
        approvedAt: p.approved_at,
        note:
          (p.status === "draft" || p.status === "rejected") && p.last_rejection_note
            ? `반려 사유: ${p.last_rejection_note}${p.note ? ` — ${p.note}` : ""}`
            : p.note,
        sessionLabels: Array.from(slotIdsByPlan.get(p.id) ?? []).map(
          (id) => slotLabelById.get(id) ?? "(삭제된 세션)"
        ),
        sessions: sessionsOf(p.id),
        postReport: p.flow === "post_report",
        reportStatus:
          p.flow === "post_report" && p.approval_id
            ? (reportStatusById.get(p.approval_id) ?? null)
            : null,
        feedbackNote: p.feedback_note,
      }));
    }
    for (const slot of slotRows) {
      for (const position of slot.positions) {
        // 전문가가 붙은 자리만 — 빈 TO는 진행 현황이 아니다
        const name = position.expertName ?? position.assignedExpertName;
        if (!name || position.status === "canceled") continue;
        progressRows.push({
          positionId: position.id,
          slotLabel: slotLabelById.get(slot.id) ?? slot.slotDate,
          code: position.code,
          expertName: name,
          // 미배정 TO는 위에서 걸렀다 — 이름은 늘 있다
          stage: stageByPosition[position.id] ?? "assigned",
          engagementId: position.engagementId,
          sessionDetail:
            [
              formatEventSchedule(
                slot.slotDate,
                slot.periodEndDate,
                slot.startsTime,
                slot.endsTime
              ),
              slot.roleDescription,
              slot.locationName,
            ]
              .filter(Boolean)
              .join(" · ") || null,
          fee: position.expectedFee ?? slot.feeAmount,
        });
      }
    }
  }

  // 승인된 세션별 송신 버튼·현황 (기획 지시 2026-09-05)
  if (tab === "engage" && modules.experts) {
    const stageNow = engagementState?.stage ?? "assigning";
    const redispatch = stageNow !== "plan_approved";
    // 단계 게이트는 서버(dispatchProjectEngagements)와 같은 판정·같은 문구 —
    // 화면만 열어 두면 눌러도 거부되는 더미 버튼이 된다 (§14-7, 리뷰 H2)
    const stageOpen =
      stageNow === "plan_approved" || REDISPATCH_STAGES.includes(stageNow);
    const blockedReason = stageOpen
      ? null
      : stageNow === "assigning"
        ? "섭외 품의를 먼저 상신·승인받아야 합니다 (규칙)."
        : stageNow === "plan_review"
          ? "섭외 품의가 결재 진행 중입니다. 승인 후 발송할 수 있습니다."
          : "수락서 송부 이후에는 일괄 발송을 쓸 수 없습니다 (규칙). 추가 섭외는 코드넘버별 개별 요청으로 진행해 주세요.";
    const approvedSlots = slotRows.filter((s) =>
      planSlotStates ? planSlotStates[s.id] === "approved" : true
    );
    // 세션별 승인 시점 — 그 전에 남은 실패 기록은 지난 상황이다 (리뷰 H3)
    const approvedSinceBySlot = new Map<string, string>();
    for (const plan of approvedPlans) {
      if (plan.status !== "approved" || !plan.approvedAt) continue;
      for (const sess of plan.sessions) {
        if (!sess.slotId) continue;
        const prev = approvedSinceBySlot.get(sess.slotId);
        if (!prev || prev < plan.approvedAt) approvedSinceBySlot.set(sess.slotId, plan.approvedAt);
      }
    }
    // 나가지 않은 자리의 최근 실패 사유 — 발송 액션이 audit_logs에 남긴다.
    // 감사로그 열람은 대표 전용 RLS라 admin으로 읽되, 대상은 RLS로 보이는 이
    // 프로젝트의 자리 id로 한정하고(tenant_id 조건만으로 넓히지 말 것 — 연습모드
    // 격리도 이 한정에 기댄다) 상태·사유 컬럼만 가져온다. service key가 없는
    // 환경에서 화면이 죽지 않도록 조회 실패는 빈 결과로 처리한다 (리뷰 M2)
    const openPositions = approvedSlots.flatMap((s) =>
      s.positions
        .filter((p) => p.status === "assigned" || p.status === "open")
        .map((p) => ({ id: p.id, slotId: s.id }))
    );
    const failureByPosition = new Map<string, string>();
    const tenantId = tenantIdFromUser(user);
    if (openPositions.length > 0 && tenantId) {
      try {
        const slotByPosition = new Map(openPositions.map((p) => [p.id, p.slotId]));
        const { data: failRows } = await createAdminClient()
          .from("audit_logs")
          .select("resource_id, after_data, created_at")
          .eq("tenant_id", tenantId)
          .eq("action", "engagement.dispatch_failed")
          .eq("resource_type", "engagement_slot_position")
          .in(
            "resource_id",
            openPositions.map((p) => p.id)
          )
          .order("created_at", { ascending: false })
          .limit(Math.min(1000, openPositions.length * 3 + 20));
        for (const row of failRows ?? []) {
          if (!row.resource_id || failureByPosition.has(row.resource_id)) continue;
          const data =
            row.after_data && typeof row.after_data === "object"
              ? (row.after_data as { reason?: unknown; kind?: unknown })
              : {};
          // 규칙 사유(결재 중 등)는 승인되면 의미가 없어진다 — 실제 실패만 보여 준다
          if (data.kind === "rule") continue;
          const since = approvedSinceBySlot.get(slotByPosition.get(row.resource_id) ?? "");
          if (since && row.created_at < since) continue;
          const reason = typeof data.reason === "string" ? data.reason : "";
          if (reason) failureByPosition.set(row.resource_id, reason);
        }
      } catch {
        // 조회 실패 = 사유 없음으로 표시. 발송 자체는 액션에서 별도 판정된다
      }
    }
    // 요청은 나갔지만 문자가 실제로 안 간 경우 — 발송 실패는 섭외 처리를
    // 막지 않으므로(engagement-sms) sms_logs에만 남는다. 그 섭외 건이 만들어진
    // 직후 창(10분) 안의 그 전문가 발송 기록만 본다 — 다른 프로젝트·세션 안내
    // 문자를 이 요청의 실패로 오인하지 않는다 (리뷰 M1). 상태·사유만 읽는다
    const engagementCreatedAt = new Map(
      (engagements ?? []).map((e) => [e.id, e.created_at] as const)
    );
    const requestedPositions = (positionRecords ?? []).filter(
      (p) =>
        p.status === "requested" &&
        p.engagement_id &&
        (p.expert_id ?? p.assigned_expert_id) &&
        engagementCreatedAt.has(p.engagement_id)
    );
    const smsNoteByPosition = new Map<string, { reason: string; kind: "error" | "info" }>();
    if (requestedPositions.length > 0 && tenantId) {
      try {
        const createdAts = requestedPositions
          .map((p) => engagementCreatedAt.get(p.engagement_id ?? "") ?? "")
          .filter(Boolean)
          .sort();
        const windowStart = createdAts[0] ?? new Date().toISOString();
        const { data: smsRows } = await createAdminClient()
          .from("sms_logs")
          .select("recipient_expert_id, status, error_message, created_at")
          .eq("tenant_id", tenantId)
          .eq("message_type", "transactional")
          .in(
            "recipient_expert_id",
            Array.from(
              new Set(
                requestedPositions.map((p) => p.expert_id ?? p.assigned_expert_id ?? "")
              )
            )
          )
          .gte("created_at", windowStart)
          .order("created_at", { ascending: true })
          .limit(500);
        for (const p of requestedPositions) {
          const expertId = p.expert_id ?? p.assigned_expert_id;
          const from = engagementCreatedAt.get(p.engagement_id ?? "");
          if (!expertId || !from) continue;
          const until = new Date(new Date(from).getTime() + 10 * 60 * 1000).toISOString();
          const inWindow = (smsRows ?? []).filter(
            (r) =>
              r.recipient_expert_id === expertId &&
              r.created_at >= from &&
              r.created_at <= until
          );
          const last = inWindow[inWindow.length - 1];
          if (!last) continue;
          if (last.status === "failed") {
            smsNoteByPosition.set(p.id, {
              kind: "error",
              reason: `문자 발송 실패 — ${last.error_message?.trim() || "공급자가 사유를 돌려주지 않았습니다"}. 설정 > 발송에서 공급자 상태를 확인한 뒤 코드넘버별 개별 요청으로 다시 보내세요.`,
            });
          } else if (last.status === "test") {
            smsNoteByPosition.set(p.id, {
              kind: "info",
              reason:
                "SMS 테스트 모드 — 실제 문자는 나가지 않았습니다 (요청 링크는 이메일·포털 알림으로만 전달).",
            });
          }
        }
      } catch {
        // 조회 실패 = 표시 없음
      }
    }
    for (const slot of approvedSlots) {
      const raw = (positionRecords ?? [])
        .filter((p) => p.slot_id === slot.id && p.status !== "canceled")
        .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no));
      const dispatchable = pickDispatchTargets(raw, slot.requiredCount, redispatch).length;
      const sent = raw.filter(
        (p) => p.status === "requested" || p.status === "filled"
      ).length;
      const accepted = raw.filter((p) => p.status === "filled").length;
      const hasHistory =
        sent > 0 || raw.some((p) => p.status === "open" && p.assigned_expert_id !== null);
      const failures = slot.positions.flatMap((p) => {
        const note =
          p.status === "requested"
            ? smsNoteByPosition.get(p.id)
            : p.status === "assigned" || p.status === "open"
              ? failureByPosition.has(p.id)
                ? { kind: "error" as const, reason: failureByPosition.get(p.id) ?? "" }
                : undefined
              : undefined;
        if (!note) return [];
        return [
          {
            code: p.code,
            expertName: p.expertName ?? p.assignedExpertName,
            reason: note.reason,
            kind: note.kind,
          },
        ];
      });
      sessionDispatch.push({
        slotId: slot.id,
        label: slotLabelById.get(slot.id) ?? slot.slotDate,
        detail:
          [
            formatEventSchedule(
              slot.slotDate,
              slot.periodEndDate,
              slot.startsTime,
              slot.endsTime
            ),
            slot.roleDescription,
            slot.locationName,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        requiredCount: slot.requiredCount,
        dispatchable,
        sent,
        accepted,
        hasHistory,
        redispatch,
        blockedReason,
        failures,
      });
    }
  }

  // 참여 건별 증빙 첨부 (기획 2026-08-30) — 종료 탭에서만 쓰지만 조회는
  // 가볍다(프로젝트당 소수). 테이블 미적용 환경은 빈 목록 폴백(§14-10)
  const settlementAttachments: Record<string, { id: string; fileName: string }> = {};
  {
    const { data: attachRows } = await supabase
      .from("settlement_line_attachments")
      .select("id, engagement_id, file_name")
      .eq("project_id", project.id);
    for (const row of attachRows ?? []) {
      settlementAttachments[row.engagement_id] = {
        id: row.id,
        fileName: row.file_name,
      };
    }
  }

  return (
    <div>
      {/* '지금 할 일' 전광판 — 목록의 전광판 내용을 페이지 최상단에서 그대로
          이어 보여준다 (긴급 취소 흐름 전광판 대체 — 기획 확정 2026-08-23) */}
      {modules.experts && (
        <div className="px-5 pt-3">
          <ProjectTodoTicker
            stage={engagementState?.stage ?? "assigning"}
            size="lg"
          />
        </div>
      )}
      <PageHeader
        title={project.name}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/projects`}>목록으로</Link>
          </Button>
        }
      />
      <ProjectTabs
        tenantSlug={params.tenantSlug}
        projectId={project.id}
        active={tab}
        hasExperts={modules.experts}
      />
      <main className="space-y-5 p-5">
        {tab === "overview" && (
          <ProjectDashboardCards
            tenantSlug={params.tenantSlug}
            data={dashboard}
            budgetAmount={project.budget_amount}
            committedCost={confirmedCost + requestedCost}
            plName={plName}
            pmName={pmName}
            deputyPmNames={deputyPmNames}
            modules={{ experts: modules.experts, approvals: modules.approvals }}
          />
        )}
        {/* 기본정보 (기획 2026-08-30 — 32번): 전 항목 상시 표시 + 수정.
            수정은 대표·이사 + 이 프로젝트에 연결된 누구나 */}
        {tab === "basic" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">기본정보</CardTitle>
              {(canViewAllProjects(grade) ||
                myAssignmentRole !== null ||
                role === "platform_admin") && (
                <BasicInfoDialog
                  tenantSlug={params.tenantSlug}
                  projectId={project.id}
                  canDelete={canViewAllProjects(grade)}
                  initial={{
                    name: project.name,
                    businessYear: String(project.business_year),
                    clientName: project.client_name ?? "",
                    code: project.code ?? "",
                    startsOn: project.starts_on ?? "",
                    endsOn: project.ends_on ?? "",
                    budgetAmount:
                      project.budget_amount !== null
                        ? String(project.budget_amount)
                        : "",
                    description: project.description ?? "",
                    hostOrg: project.host_org ?? "",
                    executorOrg: project.executor_org ?? "",
                    ddayDate: project.dday_date ?? "",
                  }}
                />
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">프로젝트명</dt>
                  <dd className="font-semibold">{project.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">발주처</dt>
                  <dd>{project.client_name ?? <span className="text-muted-foreground">미기입</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">주관</dt>
                  <dd>{project.host_org ?? <span className="text-muted-foreground">미기입</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">수행기관</dt>
                  <dd>{project.executor_org ?? <span className="text-muted-foreground">미기입</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">사업기간</dt>
                  <dd>
                    {project.starts_on ?? "?"} ~ {project.ends_on ?? "?"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">D-Day 기준일</dt>
                  <dd>
                    {project.dday_date ? (
                      <span className="font-bold text-brand-coral">
                        {(() => {
                          const diff = Math.ceil(
                            (new Date(
                              `${project.dday_date}T00:00:00+09:00`
                            ).getTime() -
                              Date.now()) /
                              (24 * 60 * 60 * 1000)
                          );
                          return diff > 0
                            ? `D-${diff}`
                            : diff === 0
                              ? "D-Day"
                              : `D+${-diff}`;
                        })()}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({project.dday_date})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">미기입</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">사업연도 · 관리코드</dt>
                  <dd>
                    {project.business_year}
                    {project.code ? ` · ${project.code}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">예산</dt>
                  <dd>
                    {project.budget_amount !== null
                      ? `${project.budget_amount.toLocaleString("ko-KR")}원`
                      : <span className="text-muted-foreground">미기입</span>}
                  </dd>
                </div>
              </dl>
              {project.description && (
                <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm text-muted-foreground">
                  {project.description}
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                이 프로젝트에 배정된 담당자는 누구나 위 <b>기본정보 수정</b>{" "}
                버튼으로 수정·추가 기입할 수 있습니다.
              </p>
            </CardContent>
          </Card>
        )}
        {tab === "basic" && assignableRoles.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">담당자 배정</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectAssignmentPanel
                projectId={project.id}
                staff={staffForAssign}
                assigned={assignedMembers}
                allowedRoles={assignableRoles}
              />
            </CardContent>
          </Card>
        )}
        {tab === "overview" && showActionRequests && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">PM 승인 (부PM 실행 건)</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionRequestPanel
                tenantSlug={params.tenantSlug}
                projectId={project.id}
                requests={actionRequests}
                isDeputy={myAssignmentRole === "deputy_pm"}
                canDecide={canDecideActions}
              />
            </CardContent>
          </Card>
        )}
        {/* 예산은 프로젝트 기초정보 — 공통 기반 */}
        {/* 유형별 세션 계획 (기획 2026-08-30 — 29·34번): 행사 = 캘린더
            일정표 / 컨설팅 = 수행기간·분야·멘티. 원본은 engagement_slots 하나다 */}
        {tab === "basic" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">
                {project.project_kind === "consulting"
                  ? "컨설팅 세션"
                  : "캘린더 일정표"}
              </CardTitle>
              <ProjectKindToggle
                projectId={project.id}
                kind={
                  project.project_kind === "consulting" ? "consulting" : "event"
                }
                canManage={canViewAllProjects(grade) || myAssignmentRole !== null}
              />
            </CardHeader>
            <CardContent>
              {project.project_kind === "consulting" ? (
                <ConsultingPanel
                  tenantSlug={params.tenantSlug}
                  projectId={project.id}
                  sessions={slotRows.map((s) => ({
                    id: s.id,
                    startsOn: s.slotDate,
                    endsOn: s.periodEndDate,
                    name: s.sessionName,
                    fieldName: s.fieldId
                      ? (sessionFieldNameById.get(s.fieldId) ?? null)
                      : null,
                    requiredCount: s.requiredCount,
                    candidateCount: s.positions.filter(
                      (p) => p.status !== "canceled"
                    ).length,
                    mentees: menteesBySlot.get(s.id) ?? [],
                  }))}
                  fieldOptions={sessionFieldOptions}
                  canManage={canInput}
                  expertsEnabled={modules.experts}
                />
              ) : (
                <ProjectCalendar
                  tenantSlug={params.tenantSlug}
                  projectId={project.id}
                  days={calendarDays}
                  sessions={slotRows.map((s) => ({
                    id: s.id,
                    date: s.slotDate,
                    startsTime: s.startsTime,
                    endsTime: s.endsTime,
                    name: s.sessionName,
                    roleType: s.roleType,
                    requiredCount: s.requiredCount,
                    locationName: s.locationName,
                    roleDescription: s.roleDescription,
                    notes: s.notes,
                    fieldId: s.fieldId,
                  }))}
                  fieldOptions={sessionFieldOptions}
                  canManage={canInput}
                  expertsEnabled={modules.experts}
                />
              )}
            </CardContent>
          </Card>
        )}
        {tab === "basic" && (
        <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">예산 · 섭외비 현황</CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetPanel
                projectId={project.id}
                budgetAmount={project.budget_amount}
                plannedCost={plannedCost}
                requestedCost={requestedCost}
                confirmedCost={confirmedCost}
                canManage={canManage}
              />
            </CardContent>
        </Card>
        )}
        {/* 세션 · 코드넘버는 공통 기반 — experts 없이도 TO 관리가 가능해야 한다 */}
        {tab === "sessions" && (
        <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">세션 · 전문가 코드넘버</CardTitle>
            </CardHeader>
            <CardContent>
              <SlotTable
                projectId={project.id}
                tenantSlug={params.tenantSlug}
                slots={slotRows}
                canManage={canInput}
                canNotice={exec.sessionNotice}
                expertsLite={expertsLite}
                expertsEnabled={modules.experts}
                noticeTemplates={noticeTemplates}
                defaultNoticeBody={DEFAULT_NOTICE_BODY}
                fieldOptions={sessionFieldOptions}
              />
            </CardContent>
        </Card>
        )}
        {tab === "overview" && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
            <span>
              <span className="text-muted-foreground">사업연도</span>{" "}
              <strong>{project.business_year}</strong>
            </span>
            {project.code && (
              <span className="font-mono text-xs text-muted-foreground">
                {project.code}
              </span>
            )}
            {project.client_name && (
              <span>
                <span className="text-muted-foreground">발주처</span>{" "}
                {project.client_name}
              </span>
            )}
            <span>
              <span className="text-muted-foreground">기간</span>{" "}
              {project.starts_on ?? "?"} ~ {project.ends_on ?? "?"}
            </span>
            {project.host_org && (
              <span>
                <span className="text-muted-foreground">주관</span>{" "}
                {project.host_org}
              </span>
            )}
            {project.executor_org && (
              <span>
                <span className="text-muted-foreground">수행기관</span>{" "}
                {project.executor_org}
              </span>
            )}
            {project.dday_date && (
              <span className="font-bold text-brand-coral">
                {(() => {
                  const diff = Math.ceil(
                    (new Date(`${project.dday_date}T00:00:00+09:00`).getTime() -
                      Date.now()) /
                      (24 * 60 * 60 * 1000)
                  );
                  return diff > 0 ? `D-${diff}` : diff === 0 ? "D-Day" : `D+${-diff}`;
                })()}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({project.dday_date})
                </span>
              </span>
            )}
            <Badge>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</Badge>
            {modules.operations && (
              <span className="ml-auto text-muted-foreground">
                진행 {done}/{stepRows.length}
              </span>
            )}
                      </CardContent>
        </Card>
        )}

        {tab === "overview" && project.description && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {project.description}
            </CardContent>
          </Card>
        )}

        {/* 프로젝트 종료 및 지급 품의 — 마감의 모든 절차를 한 탭에 모은다.
            참여율 → 세션별 만족도 → 회계담당자 검토 → 지급 품의 송신 순서다 */}
        {/* 참여율 배분 — 종료 탭에서 분리된 별도 탭 (기획 확정 2026-08-30) */}
        {tab === "contrib" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">참여율 배분 (직원 합 100%)</CardTitle>
              <Badge
                variant={
                  (settlement?.contributionTotal ?? 0) === 100
                    ? "default"
                    : "secondary"
                }
              >
                합계 {settlement?.contributionTotal ?? 0}%
              </Badge>
            </CardHeader>
            <CardContent>
              {!canEvaluate ? (
                <p className="text-sm text-muted-foreground">
                  참여율 입력은 레벨 4 이상만 할 수 있습니다 (권한 규칙). 현재
                  배분 합계는 위 뱃지로 확인할 수 있습니다.
                </p>
              ) : isClosed ? (
                <p className="text-sm text-muted-foreground">
                  종료된 프로젝트입니다. 참여율은 임원 대시보드 성과 집계에
                  반영됩니다.
                </p>
              ) : (
                <ProjectClosing
                  projectId={project.id}
                  staff={staffOptions}
                  initial={contributionInitial}
                  closingInProgress={closingInProgress}
                  approvalsActive={modules.approvals}
                  contributionsOnly={modules.experts}
                />
              )}
              {!isClosed && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {modules.experts
                    ? "합계가 100%가 되어야 프로젝트 종료 및 지급 품의 탭의 다음 단계(지급 품의 검토 요청)가 열립니다."
                    : "참여율 합계 100%를 맞춘 뒤 여기서 종료를 상신합니다."}
                </p>
              )}
            </CardContent>
          </Card>
        )}
        {tab === "closing" && (
          <ClosingTab
            approverOptions={planApprovers}
            attachmentsByEngagement={settlementAttachments}
            projectId={project.id}
            settlement={settlement}
            hasExperts={modules.experts}
            canManage={canManage}
            canEvaluate={canEvaluate}
            canReviewSettlement={canReviewSettlementDoc}
            isClosed={isClosed}
            closedAt={project.closed_at}
            reviewTargets={reviewTargets}
            expertsLite={expertsLite}
          />
        )}

        {/* 섭외 절차의 입구 — 세션(코드넘버)별로 '지금 할 일'을 펼친다 */}
        {tab === "experts" && modules.experts && (
          <EngagementWorkbench
            planApproverOptions={planApprovers}
            planRelayOn={planRelayOn}
            planFlow={planFlow}
            tenantSlug={params.tenantSlug}
            projectId={project.id}
            slots={slotRows}
            slotPlanStates={planSlotStates ? slotPlanStatesForWorkbench : null}
            canManage={canExecute}
            canInput={canInput}
            canCancel={exec.engagementCancel}
            canWithdraw={exec.engagementWithdraw}
            expertsLite={expertsLite}
            planGate={{
              blocked: Boolean(planPanel && planPanel.required && !planPanel.allowed),
              message: planPanel?.message ?? "",
              // 살아 있는 계획이 하나라도 있으면 계획별 카드(변경 품의 창구)를
              // 그린다 — 다중 계획(2026-09-05)
              appendable: Boolean(planPanel && planPanel.plans.length > 0),
            }}
            planPanel={
              planPanel ? (
                <EngagementPlanPanel
                  tenantSlug={params.tenantSlug}
                  projectId={project.id}
                  plan={planPanel}
                  canSubmit={canExecute}
                  approverOptions={planApprovers}
                  relayOn={planRelayOn}
                  postReportOn={planFlow.mode === "post_report"}
                  sessionSummary={slotRows.map((s) => ({
                    slotId: s.id,
                    label: `${s.slotDate}${
                      s.sessionName ? ` ${s.sessionName}` : ""
                    }`,
                    required: s.requiredCount,
                    // 등록 후보 = 전문가가 실제 붙은 자리 (취소 제외)
                    candidates: s.positions.filter(
                      (p) =>
                        p.status !== "canceled" &&
                        (p.expertName || p.assignedExpertName)
                    ).length,
                  }))}
                />
              ) : null
            }
            stageByPosition={stageByPosition}
            unlinked={unlinkedEngagements}
            projectState={{
              stage: engagementState?.stage ?? "assigning",
              assigned: engagementState?.assigned ?? 0,
              total: engagementState?.total ?? 0,
              open: engagementState?.open ?? 0,
              filled: engagementState?.filled ?? 0,
              fullyAssigned: engagementState?.fullyAssigned ?? false,
              dispatchable: engagementState?.dispatchable ?? 0,
            }}
            planPreview={{
              lines: (planDraft?.lines ?? []).map((l) => ({
                code: l.code,
                expertName: l.expertName,
                sessionName: l.sessionName,
                schedule: l.schedule,
                fee: l.fee,
                slotId: l.slotId,
                assigned: l.assigned,
                selected: l.selected,
                requiredCount: l.requiredCount,
              })),
              amount: planDraft?.amount ?? 0,
            }}
            headerActions={
              canExecute ? (
                <>
                  {(unlinkedCount ?? 0) > 0 && (
                    <AttachEngagementsDialog projectId={project.id} />
                  )}
                  {/* 코드넘버·계획 품의를 거치지 않는 예외 경로다 — 정식 절차
                      (①~⑤)와 같은 이름이면 어느 쪽이 진짜인지 헷갈린다 (검수 B9·G) */}
                  {directEngagementOn && (
                    <EngagementDialog
                      experts={connectedExperts}
                      projects={null}
                      defaultProjectId={project.id}
                      triggerLabel="코드 없이 바로 섭외 (예외)"
                    />
                  )}
                </>
              ) : null
            }
          />
        )}

        {/* 승인 목록 및 섭외 진행 (37번) — 결재가 난 뒤의 실행 자리:
            섭외 문자 발송 · 수락서 송부/확인 · 코드별 진행 현황 */}
        {tab === "engage" && modules.experts && (
          <EngagementProgress
            tenantSlug={params.tenantSlug}
            projectId={project.id}
            projectName={project.name}
            projectDescription={project.description}
            canManage={canExecute}
            canInput={canInput}
            expertsLite={expertsLite}
            approvalsEnabled={modules.approvals}
            projectState={{
              stage: engagementState?.stage ?? "assigning",
              dispatchable: engagementState?.dispatchable ?? 0,
              filled: engagementState?.filled ?? 0,
              requested: engagementState?.requested ?? 0,
            }}
            planGate={{
              blocked: Boolean(planPanel && planPanel.required && !planPanel.allowed),
              message: planPanel?.message ?? "",
            }}
            plans={approvedPlans}
            rows={progressRows}
            sessionDispatch={sessionDispatch}
            attachmentPanel={
              <AttachmentPanel
                projectId={project.id}
                purpose="engagement"
                title="섭외 요청 첨부"
                description="보내기 전에 붙이세요. 공통 첨부는 전원에게, 개별 첨부는 고른 전문가에게만 함께 전달됩니다."
                experts={assignedExpertOptions}
                attachments={(attachmentRows ?? [])
                  .filter((a) => a.purpose === "engagement")
                  .map((a) => ({
                    id: a.id,
                    scope: a.scope,
                    expertId: a.expert_id,
                    expertName: a.expert_id
                      ? (expertNameById.get(a.expert_id) ?? null)
                      : null,
                    fileName: a.file_name,
                  }))}
              />
            }
            acceptanceAttachmentPanel={
              <AttachmentPanel
                projectId={project.id}
                purpose="acceptance"
                title="수락서 동봉 자료"
                description="수락서를 보내는 순간 각 전문가의 수락서로 복사됩니다. 공통은 전원에게, 개별은 고른 전문가의 수락서에만 붙습니다."
                experts={assignedExpertOptions}
                attachments={(attachmentRows ?? [])
                  .filter((a) => a.purpose === "acceptance")
                  .map((a) => ({
                    id: a.id,
                    scope: a.scope,
                    expertId: a.expert_id,
                    expertName: a.expert_id
                      ? (expertNameById.get(a.expert_id) ?? null)
                      : null,
                    fileName: a.file_name,
                  }))}
              />
            }
          />
        )}

        {/* operations를 나중에 켠 회사의 기존 프로젝트 — 스텝을 잇는 경로(§1-2-8) */}
        {tab === "overview" &&
          modules.operations &&
          stepRows.length === 0 &&
          canManage && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">21스텝 라이프사이클</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  이 프로젝트에는 아직 스텝이 없습니다. 행사 운영 기능을 켜기
                  전에 만든 프로젝트입니다 — 기본 21스텝을 채워 이어서 관리할
                  수 있습니다.
                </p>
                <CreateStepsButton projectId={project.id} />
              </CardContent>
            </Card>
          )}

        {tab === "overview" &&
          STEP_TYPE_ORDER.map((stepType) => {
          const group = stepRows.filter((s) => s.step_type === stepType);
          if (group.length === 0) return null;
          // 그룹 상태 박스 — 전부 완료면 초록, 하나라도 움직였으면 파랑
          const groupResolved = group.map((step) => {
            const engagementLinked = [8, 9, 10, 15, 16].includes(step.step_no);
            const auto =
              engagementLinked && !modules.experts
                ? null
                : autoStepStatus(step.step_no, autoCtx);
            return auto ?? (step.status as StepStatus);
          });
          const groupStatus: StepStatus = groupResolved.every(
            (st) => st === "completed" || st === "skipped"
          )
            ? "completed"
            : groupResolved.some((st) => st !== "pending")
              ? "in_progress"
              : "pending";
          return (
            <Card key={stepType}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className={`inline-block h-3 w-3 rounded-sm ${STEP_STATUS_BOX_CLASS[groupStatus]}`}
                  />
                  {STEP_TYPE_LABELS[stepType]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.map((step) => {
                    // 자동 판정 가능한 스텝은 시스템 상태를 그대로 반영한다.
                    // 섭외 연동 스텝(8·9·10·15·16)은 experts 모듈이 있어야
                    // 신호가 존재한다 — 없으면 수동 선택으로 되돌린다.
                    const engagementLinked = [8, 9, 10, 15, 16].includes(
                      step.step_no
                    );
                    const auto =
                      engagementLinked && !modules.experts
                        ? null
                        : autoStepStatus(step.step_no, autoCtx);
                    const shown = auto ?? (step.status as StepStatus);
                    return (
                    <li
                      key={step.id}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <span
                        aria-label={STEP_STATUS_LABELS[shown]}
                        title={STEP_STATUS_LABELS[shown]}
                        className={`inline-block h-3 w-3 shrink-0 rounded-sm ${STEP_STATUS_BOX_CLASS[shown]}`}
                      />
                      <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                        {String(step.step_no).padStart(2, "0")}
                      </span>
                      <span
                        className={
                          shown === "completed" || shown === "skipped"
                            ? "flex-1 text-muted-foreground line-through"
                            : "flex-1 font-medium"
                        }
                      >
                        {step.title}
                      </span>
                      {step.users?.name && (
                        <span className="text-xs text-muted-foreground">
                          담당 {step.users.name}
                        </span>
                      )}
                      {step.due_on && (
                        <span className="text-xs text-muted-foreground">
                          기한 {step.due_on}
                        </span>
                      )}
                      {auto !== null ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="font-normal">
                            자동 반영
                          </Badge>
                          {STEP_STATUS_LABELS[shown]}
                        </span>
                      ) : (
                        <span className="inline-flex flex-col items-end gap-0.5">
                          <StepStatusButtons
                            stepId={step.id}
                            status={step.status}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            진행 단계를 클릭으로 선택
                          </span>
                        </span>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
