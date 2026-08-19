import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, gradeLabel } from "@/lib/auth/grades";
import {
  assignmentRoleRank,
  isAssignmentRole,
} from "@/lib/integrations/assignment-roles";
import { getProjectDashboard } from "@/lib/integrations/project-dashboard";
import {
  getProjectEngagementState,
  buildEngagementPlanDraft,
} from "@/lib/integrations/project-engagement";
import {
  getUrgentCancellations,
  getCanceledExpertByPositionCode,
} from "@/lib/integrations/urgent-cancellations";
import { DEFAULT_NOTICE_BODY } from "@/lib/integrations/notice-constants";
import { getTenantModules } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  PROJECT_STATUS_LABELS,
  STEP_TYPE_LABELS,
  type StepType,
} from "@/lib/operations/steps";
import { acceptanceStatusLabel } from "@/lib/integrations/acceptance-workflow";
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
import { UrgentCancelMarquee } from "@/components/integrations/urgent-cancel-marquee";

import { StepStatusSelect } from "./step-status-select";
import {
  ExpertEvaluationForm,
  type ExpertEvaluationRow,
} from "./expert-evaluation-form";
import { ProjectClosing } from "./project-closing";
import { ProjectAssignmentPanel } from "./project-assignment-panel";
import {
  ActionRequestPanel,
  type ActionRequestRow,
} from "./action-request-panel";
import { AttachEngagementsDialog } from "./attach-engagements-dialog";
import { SlotTable, type SlotRow } from "./slot-table";
import { BudgetPanel } from "./budget-panel";
import { ProjectDashboardCards } from "./project-dashboard-cards";
import {
  EngagementPlanPanel,
  type PlanPanelState,
} from "./engagement-plan-panel";
import { ProjectTabs, resolveProjectTab } from "./project-tabs";
import {
  EngagementWorkbench,
  type UnlinkedEngagement,
} from "./engagement-workbench";

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
    evaluationsResult,
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
      // 단계 27: 프로젝트 종료 평가 (테넌트 격리 — 전문가 비공개)
      modules.experts
        ? supabase
            .from("expert_evaluations")
            .select("expert_id, score, reason")
            .eq("project_id", project.id)
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

  // 단계 27: 수락(계약 성립)된 섭외 = 평가 대상. 전문가별 1건 (중복 제거).
  const evaluationByExpert = new Map(
    (evaluationsResult.data ?? []).map((e) => [e.expert_id, e])
  );

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
  const seenExpert = new Set<string>();
  const evaluationRows: ExpertEvaluationRow[] = [];
  for (const engagement of engagements) {
    if (engagement.status !== "accepted") continue;
    if (seenExpert.has(engagement.expert_id)) continue;
    seenExpert.add(engagement.expert_id);
    const existing = evaluationByExpert.get(engagement.expert_id);
    evaluationRows.push({
      expertId: engagement.expert_id,
      engagementId: engagement.id,
      name: engagement.experts?.name ?? "-",
      // 참여 세션은 슬롯을 읽은 뒤에 채운다 (아래 sessionsByExpert)
      sessions: [],
      score: existing?.score ?? null,
      reason: existing?.reason ?? null,
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
  const unevaluatedCount = evaluationRows.filter((r) => r.score === null).length;

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
  // 승인 주체는 PM. 대표·이사는 전사 열람 권한과 함께 승인도 할 수 있다.
  const canDecideActions =
    myAssignmentRole === "pm" || canViewAllProjects(gradeFromUser(user));
  const showActionRequests =
    actionRequests.length > 0 ||
    myAssignmentRole === "deputy_pm" ||
    canDecideActions;

  const pmName =
    assignedMembers.find((m) => m.assignmentRole === "pm")?.name ?? null;
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
          "id, slot_id, position_no, code, status, expert_id, engagement_id, assigned_expert_id"
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

  // 긴급 취소 — 이 프로젝트 건만. 재섭외 대상 자리를 눈에 띄게 표시한다.
  const [urgentCancels, canceledByCode] = modules.experts
    ? await Promise.all([
        getUrgentCancellations({ projectId: project.id }),
        getCanceledExpertByPositionCode(project.id),
      ])
    : [[], {} as Record<string, string>];

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
      .map((p) => ({
        id: p.id,
        code: p.code,
        positionNo: p.position_no,
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
  for (const row of evaluationRows) {
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


  // 프로젝트 단위 진행 단계 + 품의서 미리보기 — 버튼 활성 조건의 단일 근거
  const [engagementState, planDraft] = modules.experts
    ? await Promise.all([
        getProjectEngagementState(project.id),
        buildEngagementPlanDraft(project.id),
      ])
    : [null, null];

  const tab = resolveProjectTab(searchParams.tab, modules.experts);

  return (
    <div>
      <UrgentCancelMarquee items={urgentCancels} tenantSlug={params.tenantSlug} />
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
        {tab === "plan" && modules.experts && planPanel && (
          <EngagementPlanPanel
            tenantSlug={params.tenantSlug}
            projectId={project.id}
            plan={planPanel}
            canSubmit={canManage}
            approverOptions={planApprovers}
            hasProjectRule={hasProjectRule}
          />
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

        {tab === "basic" && canEvaluate && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">프로젝트 종료</CardTitle>
              {isClosed && (
                <Badge>
                  종료됨
                  {project.closed_at
                    ? ` · ${new Date(project.closed_at).toLocaleDateString("ko-KR")}`
                    : ""}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {isClosed ? (
                <p className="text-sm text-muted-foreground">
                  이 프로젝트는 종료되었습니다. 참여 기여도는 임원 대시보드 성과
                  집계에 반영됩니다.
                </p>
              ) : (
                <ProjectClosing
                  projectId={project.id}
                  staff={staffOptions}
                  initial={contributionInitial}
                  closingInProgress={closingInProgress}
                  approvalsActive={modules.approvals}
                />
              )}
            </CardContent>
          </Card>
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
            stageByPosition={stageByPosition}
            unlinked={unlinkedEngagements}
            projectState={{
              stage: engagementState?.stage ?? "assigning",
              assigned: engagementState?.assigned ?? 0,
              total: engagementState?.total ?? 0,
              open: engagementState?.open ?? 0,
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

        {tab === "basic" && modules.experts && evaluationRows.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">
                프로젝트 마감 평가 ({evaluationRows.length - unevaluatedCount}/
                {evaluationRows.length})
              </CardTitle>
              {unevaluatedCount > 0 ? (
                <Badge variant="secondary">미완료 {unevaluatedCount}</Badge>
              ) : (
                <Badge>평가 완료</Badge>
              )}
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                프로젝트를 마감할 때 참여 전문가를 간단히 평가합니다. 전원을
                평가해야 수당 지급 품의를 올릴 수 있습니다. 여기서 남긴 점수는
                다음 섭외에서 <strong>후보 목록의 ‘평판’</strong>으로 다시
                보입니다. 평가(점수·사유)는{" "}
                <strong>전문가에게 공개되지 않으며</strong> 회사 내부 기록으로만
                보관됩니다.
              </p>
              {canEvaluate ? (
                <ul className="divide-y">
                  {evaluationRows.map((row) => (
                    <ExpertEvaluationForm
                      key={row.expertId}
                      projectId={project.id}
                      row={row}
                    />
                  ))}
                </ul>
              ) : (
                <ul className="divide-y">
                  {evaluationRows.map((row) => (
                    <li
                      key={row.expertId}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <span className="font-medium">{row.name}</span>
                      {row.sessions.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {row.sessions.join(" · ")}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {row.score !== null
                          ? `평가 완료 · ${row.score}점`
                          : "평가 미완료"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "acceptances" && modules.experts && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                수락서 생성 및 확정 ({acceptedEngagements.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                전문가가 섭외를 수락하면 수락서가 자동 생성됩니다. 안내 정보를
                보완해 송부하고, 전문가 확인 후 담당자가 최종 확인합니다. 수락서는
                화면에서만 열람하며 파일로 내려받지 않습니다.
              </p>
              {acceptedEngagements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 수락(확정)된 섭외 건이 없습니다. ‘전문가 등록’ 탭에서 섭외를
                  요청하세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {acceptedEngagements.map((engagement) => {
                    const acceptance = acceptanceByEngagement.get(engagement.id);
                    return (
                      <li
                        key={engagement.id}
                        className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                      >
                        <span className="font-medium">
                          {engagement.experts?.name ?? "-"}
                        </span>
                        <span className="text-muted-foreground">
                          {engagement.role_description}
                        </span>
                        {acceptance?.letter_no && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {acceptance.letter_no}
                          </span>
                        )}
                        <Badge
                          className="ml-auto"
                          variant={
                            acceptance?.status === "confirmed"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {acceptance
                            ? acceptanceStatusLabel(acceptance.status)
                            : "생성 대기"}
                        </Badge>
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/${params.tenantSlug}/experts/acceptances/${engagement.id}`}
                          >
                            수락서 열기
                          </Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
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
