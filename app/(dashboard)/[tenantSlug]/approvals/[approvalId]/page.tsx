import Link from "next/link";
import { notFound } from "next/navigation";

import { getSessionUser, requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
  STEP_KIND_LABELS,
  STEP_STATUS_LABELS,
  formatKrw,
} from "@/lib/approvals/constants";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ActPanel } from "./act-panel";
import { PlanReviewPanel, type ReviewSlot } from "./plan-review-panel";

export const metadata = { title: "결재 상세" };

/** 결재 상세 — 결재라인 진행 상태·대결 병기·재상신 이력. 모바일 완전 대응. */
export default async function ApprovalDetailPage({
  params,
}: {
  params: { tenantSlug: string; approvalId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("approvals");

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="결재 상세" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const user = await getSessionUser();
  const supabase = createClient();

  // projects 임베드는 FK 힌트 필수 — projects.closing_approval_id(종료 품의)가
  // 생긴 뒤로 approvals↔projects 관계가 둘이라, 힌트 없는 임베드는 모호성
  // 오류(PGRST201)로 조회 전체가 죽고 화면은 404가 됐다 (렛츠 실사고).
  const { data: approval, error: approvalError } = await supabase
    .from("approvals")
    .select(
      `id, title, body, approval_type, amount, status, created_at, completed_at,
       requester_user_id, resubmitted_from_id, project_id,
       requester:users!approvals_requester_user_id_fkey (name),
       projects!approvals_project_id_fkey (name)`
    )
    .eq("id", params.approvalId)
    .maybeSingle();

  if (approvalError) {
    // 쿼리 결함을 '없는 문서(404)'로 위장하면 원인 추적이 막힌다 (§12-9)
    console.error("approval detail query failed:", approvalError.message);
  }
  if (!approval) notFound();

  const { data: steps } = await supabase
    .from("approval_steps")
    .select(
      `id, step_order, step_kind, status, acted_at, comment,
       approver_user_id,
       approver:users!approval_steps_approver_user_id_fkey (name),
       acted_by:users!approval_steps_acted_by_user_id_fkey (name)`
    )
    .eq("approval_id", approval.id)
    .order("step_order", { ascending: true });

  const stepRows = steps ?? [];

  // 내 차례 판정 (표시용 — 서버 액션이 다시 검증한다)
  const pendingSteps = stepRows.filter((s) => s.status === "pending");
  const currentOrder =
    approval.status === "in_progress" && pendingSteps.length > 0
      ? Math.min(...pendingSteps.map((s) => s.step_order))
      : null;
  const currentGroup =
    currentOrder === null
      ? []
      : pendingSteps.filter((s) => s.step_order === currentOrder);

  let canAct = false;
  let actingAsDelegate = false;
  if (user && currentGroup.length > 0) {
    if (currentGroup.some((s) => s.approver_user_id === user.id)) {
      canAct = true;
    } else {
      const { data: delegations } = await supabase
        .from("approval_delegations")
        .select("delegator_user_id, starts_on, ends_on")
        .eq("delegate_user_id", user.id)
        .eq("is_active", true);
      const today = new Date().toISOString().slice(0, 10);
      const delegators = new Set(
        (delegations ?? [])
          .filter((d) => d.starts_on <= today && today <= d.ends_on)
          .map((d) => d.delegator_user_id)
      );
      if (currentGroup.some((s) => delegators.has(s.approver_user_id))) {
        canAct = true;
        actingAsDelegate = true;
      }
    }
  }

  const isRequester = user?.id === approval.requester_user_id;
  const nothingActed = stepRows.every((s) => s.status === "pending");
  const canCancel =
    isRequester && approval.status === "in_progress" && nothingActed;
  const canResubmit = isRequester && approval.status === "rejected";

  // 섭외계획 품의라면 후보 검토(결재권자 수정) + 변경 내역을 붙인다
  // (기획 확정 2026-08-22 — 후보 순위 모델)
  let reviewSlots: ReviewSlot[] = [];
  type ReviewChange = {
    actorName: string;
    kind: string;
    positionCode: string | null;
    expertName: string | null;
    before: string | null;
    after: string | null;
    createdAt: string;
  };
  let reviewChanges: ReviewChange[] = [];
  let isPlanApproval = false;
  {
    const { data: plan } = await supabase
      .from("engagement_plans")
      .select("id, project_id")
      .eq("approval_id", approval.id)
      .maybeSingle();
    if (plan) {
      isPlanApproval = true;
      const { data: planSlots } = await supabase
        .from("engagement_slots")
        .select("id, slot_date, starts_time, session_name, role_type, required_count")
        .eq("project_id", plan.project_id)
        .order("slot_date", { ascending: true })
        .order("starts_time", { ascending: true });
      const planSlotIds = (planSlots ?? []).map((s) => s.id);
      const { data: candidates } = planSlotIds.length
        ? await supabase
            .from("engagement_slot_positions")
            .select(
              "id, slot_id, code, status, engagement_id, assigned_expert_id, rank, position_no, expected_fee"
            )
            .in("slot_id", planSlotIds)
            .neq("status", "canceled")
        : { data: [] as never[] };
      const candidateExpertIds = Array.from(
        new Set(
          (candidates ?? [])
            .map((c) => c.assigned_expert_id)
            .filter((id): id is string => id !== null)
        )
      );
      const { data: candidateExperts } = candidateExpertIds.length
        ? await supabase
            .from("experts")
            .select("id, name")
            .in("id", candidateExpertIds)
        : { data: [] as never[] };
      const expertNameById = new Map(
        (candidateExperts ?? []).map((e) => [e.id, e.name])
      );
      reviewSlots = (planSlots ?? []).map((slot) => ({
        slotId: slot.id,
        label: `${slot.session_name ?? slot.role_type} · ${slot.slot_date}${
          slot.starts_time ? ` ${slot.starts_time.slice(0, 5)}` : ""
        }`,
        requiredCount: slot.required_count,
        candidates: (candidates ?? [])
          .filter((c) => c.slot_id === slot.id)
          .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no))
          .map((c) => ({
            id: c.id,
            code: c.code,
            expertName: c.assigned_expert_id
              ? (expertNameById.get(c.assigned_expert_id) ?? null)
              : null,
            expectedFee: c.expected_fee,
            editable:
              c.engagement_id === null &&
              (c.status === "open" || c.status === "assigned"),
          })),
      }));

      const { data: changeRows } = await supabase
        .from("plan_review_changes")
        .select(
          "change_kind, position_code, expert_name, before_text, after_text, created_at, actor:users!plan_review_changes_actor_user_id_fkey (name)"
        )
        .eq("approval_id", approval.id)
        .order("created_at", { ascending: true });
      reviewChanges = (changeRows ?? []).map((c) => ({
        actorName: c.actor?.name ?? "(알 수 없음)",
        kind: c.change_kind,
        positionCode: c.position_code,
        expertName: c.expert_name,
        before: c.before_text,
        after: c.after_text,
        createdAt: c.created_at,
      }));
    }
  }
  const canEditPlan =
    canAct && !actingAsDelegate && approval.status === "in_progress";
  const changesByActor = new Map<string, ReviewChange[]>();
  for (const c of reviewChanges) {
    const list = changesByActor.get(c.actorName) ?? [];
    list.push(c);
    changesByActor.set(c.actorName, list);
  }
  const CHANGE_KIND_LABELS: Record<string, string> = {
    reorder: "순위 변경",
    remove: "후보 제외",
    fee: "예정가 수정",
  };

  return (
    <div>
      <PageHeader
        title="결재 상세"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/approvals`}>목록으로</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-5">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {APPROVAL_TYPE_LABELS[approval.approval_type] ??
                  approval.approval_type}
              </Badge>
              <Badge
                variant={
                  approval.status === "rejected"
                    ? "destructive"
                    : approval.status === "in_progress"
                      ? "default"
                      : "secondary"
                }
              >
                {APPROVAL_STATUS_LABELS[approval.status] ?? approval.status}
              </Badge>
              {approval.resubmitted_from_id && (
                <Link
                  href={`/${params.tenantSlug}/approvals/${approval.resubmitted_from_id}`}
                  className="text-xs text-brand underline-offset-4 hover:underline"
                >
                  원 결재건 보기 (재상신)
                </Link>
              )}
            </div>
            <h2 className="text-lg font-bold">{approval.title}</h2>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span>상신 {approval.requester?.name ?? "-"}</span>
              <span>
                {new Date(approval.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
              </span>
              {approval.amount !== null && (
                <span className="font-medium text-foreground">
                  {formatKrw(approval.amount)}
                </span>
              )}
              {approval.projects?.name && approval.project_id && (
                <Link
                  href={`/${params.tenantSlug}/projects/${approval.project_id}`}
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {approval.projects.name}
                </Link>
              )}
            </div>
            {approval.body && (
              <p className="whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm">
                {approval.body}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">결재라인</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {stepRows.map((step) => {
                const isCurrent =
                  currentOrder !== null && step.step_order === currentOrder;
                return (
                  <li
                    key={step.id}
                    className={`rounded-md border p-3 text-sm ${
                      isCurrent && step.status === "pending"
                        ? "border-brand/50 bg-brand/5"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {step.step_order}차
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {STEP_KIND_LABELS[step.step_kind] ?? step.step_kind}
                      </Badge>
                      <span className="font-medium">
                        {step.approver?.name ?? "-"}
                      </span>
                      {step.acted_by?.name &&
                        step.acted_by.name !== step.approver?.name && (
                          <span className="text-xs text-brand">
                            대결: {step.acted_by.name}
                          </span>
                        )}
                      <Badge
                        className="ml-auto"
                        variant={
                          step.status === "approved"
                            ? "secondary"
                            : step.status === "rejected"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {STEP_STATUS_LABELS[step.status] ?? step.status}
                      </Badge>
                    </div>
                    {(step.comment || step.acted_at) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {step.comment && <span>“{step.comment}”</span>}
                        {step.acted_at && (
                          <span>
                            {new Date(step.acted_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              같은 차수의 결재자들은 병렬 합의로 순서 없이 동시에 처리하며, 전원
              승인 시 다음 차수로 넘어갑니다.
            </p>
          </CardContent>
        </Card>

        {isPlanApproval && (
          <Card className="border-orange-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                섭외 후보 검토
                {canEditPlan && (
                  <span className="ml-2 rounded-full bg-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    수정 가능 — 순위·금액·후보
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PlanReviewPanel
                approvalId={approval.id}
                slots={reviewSlots}
                canEdit={canEditPlan}
              />
            </CardContent>
          </Card>
        )}

        {isPlanApproval && changesByActor.size > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">결재권자 변경 내역</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from(changesByActor.entries()).map(([actor, changes]) => (
                <div key={actor} className="rounded-md border p-3">
                  <p className="text-sm font-semibold">{actor}</p>
                  <ul className="mt-1.5 space-y-1">
                    {changes.map((c, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1.5 text-[10px]">
                          {CHANGE_KIND_LABELS[c.kind] ?? c.kind}
                        </Badge>
                        {c.positionCode && (
                          <span className="mr-1 font-mono">[{c.positionCode}]</span>
                        )}
                        {c.expertName && <span className="mr-1">{c.expertName}</span>}
                        {c.before && c.after && (
                          <span>
                            {c.before} <span className="mx-0.5">→</span> {c.after}
                          </span>
                        )}
                        <span className="ml-1.5">
                          {new Date(c.createdAt).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                담당자는 이 내역으로 어떤 결재권자가 무엇을 변경했는지 확인할 수
                있습니다. 결재 의견은 위 결재라인의 따옴표 문구입니다.
              </p>
            </CardContent>
          </Card>
        )}

        <ActPanel
          tenantSlug={params.tenantSlug}
          approvalId={approval.id}
          canAct={canAct}
          actingAsDelegate={actingAsDelegate}
          canCancel={canCancel}
          canResubmit={canResubmit}
        />
      </main>
    </div>
  );
}
