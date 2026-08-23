import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, gradeLabel } from "@/lib/auth/grades";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import {
  assignmentRoleRank,
  isAssignmentRole,
  isPlRole,
  isPmRole,
} from "@/lib/integrations/assignment-roles";
import { getProjectDashboard } from "@/lib/integrations/project-dashboard";
import {
  getProjectEngagementState,
  buildEngagementPlanDraft,
} from "@/lib/integrations/project-engagement";
import { getCanceledExpertByPositionCode } from "@/lib/integrations/urgent-cancellations";
import { DEFAULT_NOTICE_BODY } from "@/lib/integrations/notice-constants";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  PROJECT_STATUS_LABELS,
  STEP_TYPE_LABELS,
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
} from "@/lib/integrations/engagement-plans";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EngagementDialog } from "@/components/integrations/engagement-dialog";
import { ProjectTodoTicker } from "@/components/projects/todo-ticker";

import { AttachmentPanel } from "./attachment-panel";

import { StepStatusSelect } from "./step-status-select";
import { type ExpertReviewTarget } from "./expert-review-form";
import { ProjectAssignmentPanel } from "./project-assignment-panel";
import {
  ActionRequestPanel,
  type ActionRequestRow,
} from "./action-request-panel";
import { CreateStepsButton } from "./create-steps-button";
import { AttachEngagementsDialog } from "./attach-engagements-dialog";
import { SlotTable, type SlotRow } from "./slot-table";
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
import { ClosingTab } from "./closing-tab";

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
  const canEvaluate = role === "org_admin" || role === "manager";

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

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, status, starts_on, ends_on, description, closing_approval_id, closed_at, budget_amount"
    )
    .eq("id", params.projectId)
    .maybeSingle();

  if (!project) notFound();

  const modules = await getTenantModules();

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
              "id, expert_id, role_description, fee_amount, status, created_at, experts (name)"
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
      // 세션별 정보 + 전문가 코드넘버 — 공통 기반(모듈 무관하게 항상 제공)
      supabase
        .from("engagement_slots")
        .select(
          "id, slot_date, starts_time, ends_time, role_type, session_name, role_description, required_count, fee_amount, location_name"
        )
        .eq("project_id", project.id)
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
  // Phase A-1: 배정 패널용 (권한자만 렌더)
  const canManage = role === "org_admin" || role === "manager";

  // 섭외계획 품의 게이트 (experts 모듈에서만 의미가 있다)
  let planPanel: PlanPanelState | null = null;
  let planApprovers: { id: string; name: string; gradeLabel: string }[] = [];
  let hasProjectRule = false;
  if (modules.experts) {
    const [gate, snapshot] = await Promise.all([
      evaluatePlanGate(project.id, modules.approvals),
      buildPlanSnapshot(project.id),
    ]);
    planPanel = {
      required: gate.required,
      allowed: gate.required ? gate.allowed : true,
      state: gate.required ? gate.state : "module_off",
      message: gate.required ? gate.message : "",
      revision: gate.required ? (gate.plan?.revision ?? null) : null,
      approvalId: gate.required ? (gate.plan?.approvalId ?? null) : null,
      plannedAmount:
        gate.required && gate.plan?.status === "approved"
          ? gate.plan.plannedAmount
          : null,
      positionCount:
        gate.required && gate.plan?.status === "approved"
          ? gate.plan.positionCount
          : null,
      currentPlannedAmount: snapshot.plannedAmount,
      currentPositionCount: snapshot.positionCount,
      currentSlotCount: snapshot.slotCount,
    };

    // 전결규정이 없을 때 직접 지정할 결재자 후보 (본인 제외 활성 직원)
    planApprovers = (staffResult.data ?? [])
      .filter((u) => u.is_active && u.id !== user?.id)
      .map((u) => ({
        id: u.id,
        name: u.name,
        gradeLabel: gradeLabel(u.grade),
      }));

    if (modules.approvals) {
      const { count } = await supabase
        .from("approval_rules")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .or("approval_type.is.null,approval_type.eq.project");
      hasProjectRule = (count ?? 0) > 0;
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
  const { data: actionRequestRecords } = await supabase
    .from("project_action_requests")
    .select(
      "id, action_type, target_id, request_note, status, requested_by, decided_by, decision_note, consumed_at, created_at"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const actionRequests: ActionRequestRow[] = (actionRequestRecords ?? []).map(
    (r) => ({
      id: r.id,
      actionType: r.action_type,
      targetId: r.target_id,
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

  // Phase B-1: 슬롯별 넘버링코드 인원 조회
  const slotRecords = slotsResult.data ?? [];
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

  const slotRows: SlotRow[] = slotRecords.map((s) => ({
    id: s.id,
    slotDate: s.slot_date,
    startsTime: s.starts_time,
    endsTime: s.ends_time,
    roleType: s.role_type,
    sessionName: s.session_name,
    roleDescription: s.role_description,
    requiredCount: s.required_count,
    feeAmount: s.fee_amount,
    locationName: s.location_name,
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
        planState,
      });
    }
  }

  // 코드넘버에 붙지 않은 섭외 건 — 세션 아래 자리가 없으므로 작업대 끝에 모은다
  const linkedEngagementIds = new Set(
    slotRows.flatMap((slot) =>
      slot.positions
        .map((p) => p.engagementId)
        .filter((id): id is string => id !== null)
    )
  );
  const unlinkedEngagements: UnlinkedEngagement[] = engagements
    .filter((e) => !linkedEngagementIds.has(e.id))
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
        getProjectEngagementState(project.id),
        buildEngagementPlanDraft(project.id),
      ])
    : [null, null];

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
        {tab === "basic" && canManage && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">담당자 배정</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectAssignmentPanel
                projectId={project.id}
                staff={staffForAssign}
                assigned={assignedMembers}
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
                canManage={canManage}
                noticeTemplates={noticeTemplates}
                defaultNoticeBody={DEFAULT_NOTICE_BODY}
              />
            </CardContent>
        </Card>
        )}
        {(tab === "overview" || tab === "basic") && (
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
            <Badge>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</Badge>
            {modules.operations && (
              <span className="ml-auto text-muted-foreground">
                진행 {done}/{stepRows.length}
              </span>
            )}
          </CardContent>
        </Card>
        )}

        {(tab === "overview" || tab === "basic") && project.description && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {project.description}
            </CardContent>
          </Card>
        )}

        {/* 프로젝트 종료 및 지급 품의 — 마감의 모든 절차를 한 탭에 모은다.
            참여율 → 세션별 만족도 → 회계담당자 검토 → 지급 품의 송신 순서다 */}
        {tab === "closing" && (
          <ClosingTab
            projectId={project.id}
            settlement={settlement}
            hasExperts={modules.experts}
            hasApprovals={modules.approvals}
            canManage={canManage}
            canEvaluate={canEvaluate}
            canReviewSettlement={canReviewSettlementDoc}
            isClosed={isClosed}
            closedAt={project.closed_at}
            closingInProgress={closingInProgress}
            staff={staffOptions}
            contributionInitial={contributionInitial}
            reviewTargets={reviewTargets}
          />
        )}

        {/* 섭외 절차의 입구 — 세션(코드넘버)별로 '지금 할 일'을 펼친다 */}
        {tab === "experts" && modules.experts && (
          <EngagementWorkbench
            tenantSlug={params.tenantSlug}
            projectId={project.id}
            slots={slotRows}
            canManage={canManage}
            planGate={{
              blocked: Boolean(planPanel && planPanel.required && !planPanel.allowed),
              message: planPanel?.message ?? "",
            }}
            planPanel={
              planPanel ? (
                <EngagementPlanPanel
                  tenantSlug={params.tenantSlug}
                  projectId={project.id}
                  plan={planPanel}
                  canSubmit={canManage}
                  approverOptions={planApprovers}
                  hasProjectRule={hasProjectRule}
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
            }}
            planPreview={{
              lines: (planDraft?.lines ?? []).map((l) => ({
                code: l.code,
                expertName: l.expertName,
                sessionName: l.sessionName,
                schedule: l.schedule,
                fee: l.fee,
              })),
              amount: planDraft?.amount ?? 0,
            }}
            projectName={project.name}
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
            headerActions={
              canManage ? (
                <>
                  {(unlinkedCount ?? 0) > 0 && (
                    <AttachEngagementsDialog projectId={project.id} />
                  )}
                  <EngagementDialog
                    experts={connectedExperts}
                    projects={null}
                    defaultProjectId={project.id}
                  />
                </>
              ) : null
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
          return (
            <Card key={stepType}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {STEP_TYPE_LABELS[stepType]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.map((step) => (
                    <li
                      key={step.id}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                        {String(step.step_no).padStart(2, "0")}
                      </span>
                      <span
                        className={
                          step.status === "completed" || step.status === "skipped"
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
                      <StepStatusSelect stepId={step.id} status={step.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
