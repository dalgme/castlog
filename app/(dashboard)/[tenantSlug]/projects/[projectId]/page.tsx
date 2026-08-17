import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { gradeLabel } from "@/lib/auth/grades";
import {
  assignmentRoleRank,
  isAssignmentRole,
} from "@/lib/integrations/assignment-roles";
import { getProjectDashboard } from "@/lib/integrations/project-dashboard";
import { getTenantModules, requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  PROJECT_STATUS_LABELS,
  STEP_TYPE_LABELS,
  type StepType,
} from "@/lib/operations/steps";
import { formatKrw } from "@/lib/approvals/constants";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
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
import { EngagementCancelButton } from "@/components/integrations/engagement-cancel-button";
import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";

import { StepStatusSelect } from "./step-status-select";
import {
  ExpertEvaluationForm,
  type ExpertEvaluationRow,
} from "./expert-evaluation-form";
import { ProjectClosing } from "./project-closing";
import { ProjectAssignmentPanel } from "./project-assignment-panel";
import { SlotTable, type SlotRow } from "./slot-table";
import { BudgetPanel } from "./budget-panel";
import { ProjectDashboardCards } from "./project-dashboard-cards";
import {
  EngagementPlanPanel,
  type PlanPanelState,
} from "./engagement-plan-panel";

export const metadata = { title: "프로젝트 상세" };

const STEP_TYPE_ORDER: StepType[] = [
  "preparation",
  "recruitment",
  "operation",
  "settlement",
  "reporting",
];

/**
 * 프로젝트 상세 — 21스텝 라이프사이클 진행 관리 (operations 모듈).
 * 스텝은 오케스트레이션 전용 — 각 단계의 업무 데이터는 전용 화면에서 다룬다.
 * 조회는 모바일 대응, 입력은 PC 최적화 (CLAUDE.md 10).
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: { tenantSlug: string; projectId: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  await requireModule("operations");

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
      supabase
        .from("project_lifecycle_steps")
        .select(
          "id, step_no, step_type, title, status, due_on, completed_at, users (name)"
        )
        .eq("project_id", project.id)
        .order("step_no", { ascending: true }),
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
      // Phase B-1: 섭외 테이블(타임테이블 + 넘버링코드 인원)
      modules.experts
        ? supabase
            .from("engagement_slots")
            .select(
              "id, slot_date, starts_time, ends_time, role_type, role_description, required_count, fee_amount, location_name"
            )
            .eq("project_id", project.id)
            .order("slot_date", { ascending: true })
            .order("starts_time", { ascending: true })
        : Promise.resolve({ data: null }),
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
      score: existing?.score ?? null,
      reason: existing?.reason ?? null,
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
        .select("id, slot_id, position_no, code, status, expert_id")
        .in("slot_id", slotIds)
        .order("position_no", { ascending: true })
    : { data: [] };
  const positionExpertIds = Array.from(
    new Set((positionRecords ?? []).map((p) => p.expert_id).filter(Boolean))
  ) as string[];
  const { data: positionExperts } = positionExpertIds.length
    ? await supabase.from("experts").select("id, name").in("id", positionExpertIds)
    : { data: [] };
  const expertNameById = new Map(
    (positionExperts ?? []).map((e) => [e.id, e.name])
  );
  const slotRows: SlotRow[] = slotRecords.map((s) => ({
    id: s.id,
    slotDate: s.slot_date,
    startsTime: s.starts_time,
    endsTime: s.ends_time,
    roleType: s.role_type,
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
      })),
  }));
  const contributionInitial: Record<string, number> = {};
  for (const c of contributionsResult.data ?? []) {
    contributionInitial[c.user_id] = c.percentage;
  }
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

  const dashboard = await getProjectDashboard(project.id, {
    experts: modules.experts,
    approvals: modules.approvals,
  });

  const isClosed = project.status === "completed";
  const closingInProgress =
    project.closing_approval_id !== null && !isClosed;

  return (
    <div>
      <PageHeader
        title={project.name}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/projects`}>목록으로</Link>
          </Button>
        }
      />
      <main className="space-y-5 p-5">
        <ProjectDashboardCards
          tenantSlug={params.tenantSlug}
          data={dashboard}
          budgetAmount={project.budget_amount}
          committedCost={confirmedCost + requestedCost}
          pmName={pmName}
          deputyPmNames={deputyPmNames}
          modules={{ experts: modules.experts, approvals: modules.approvals }}
        />
        {canManage && (
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
        {modules.experts && (
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
        {modules.experts && planPanel && (
          <EngagementPlanPanel
            tenantSlug={params.tenantSlug}
            projectId={project.id}
            plan={planPanel}
            canSubmit={canManage}
            approverOptions={planApprovers}
            hasProjectRule={hasProjectRule}
          />
        )}
        {modules.experts && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">섭외 테이블 (타임테이블 · 넘버링코드)</CardTitle>
            </CardHeader>
            <CardContent>
              <SlotTable
                projectId={project.id}
                tenantSlug={params.tenantSlug}
                slots={slotRows}
                canManage={canManage}
              />
            </CardContent>
          </Card>
        )}
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
            <span className="ml-auto text-muted-foreground">
              진행 {done}/{stepRows.length}
            </span>
          </CardContent>
        </Card>

        {project.description && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {project.description}
            </CardContent>
          </Card>
        )}

        {canEvaluate && (
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

        {modules.experts && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">
                전문가 섭외 ({engagements.length})
              </CardTitle>
              <EngagementDialog
                experts={connectedExperts}
                projects={null}
                defaultProjectId={project.id}
              />
            </CardHeader>
            <CardContent>
              {engagements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  이 프로젝트에 섭외된 전문가가 없습니다. ‘섭외 요청’으로 동의
                  링크를 만들어 전달하세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {engagements.map((engagement) => (
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
                      {engagement.fee_amount !== null && (
                        <span className="text-xs text-muted-foreground">
                          {formatKrw(engagement.fee_amount)}
                        </span>
                      )}
                      <Badge
                        className="ml-auto"
                        variant={
                          engagement.status === "accepted"
                            ? "default"
                            : engagement.status === "declined"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {ENGAGEMENT_STATUS_LABELS[engagement.status] ??
                          engagement.status}
                      </Badge>
                      {engagement.status === "requested" && (
                        <EngagementCancelButton engagementId={engagement.id} />
                      )}
                      {engagement.status === "accepted" && (
                        <>
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/${params.tenantSlug}/experts/acceptances/${engagement.id}`}
                            >
                              수락서
                            </Link>
                          </Button>
                          <EngagementUrgentCancel
                            engagementId={engagement.id}
                            expertName={engagement.experts?.name ?? "전문가"}
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {modules.experts && evaluationRows.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">
                전문가 평가 ({evaluationRows.length - unevaluatedCount}/
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
                프로젝트에 참여한 전문가 전원을 평가해야 수당 지급 품의를 올릴 수
                있습니다. 평가(점수·사유)는 <strong>전문가에게 공개되지 않으며</strong>{" "}
                회사 내부 기록으로만 보관됩니다.
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

        {STEP_TYPE_ORDER.map((stepType) => {
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
