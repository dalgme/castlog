"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { gradeRank, isUserGrade } from "@/lib/auth/grades";
import {
  buildPlanSnapshot,
  getPlanCoveredSlotIds,
} from "@/lib/integrations/engagement-plans";
import { formatKrw } from "@/lib/approvals/constants";

/**
 * 결재권자의 섭외계획 수정 (기획 확정 2026-08-22)
 *
 * 섭외계획 품의가 결재 중일 때, **지금 결재 차례인 결재권자**가 문서를
 * 반려하지 않고도 순위 변경·후보 삭제·예정가 수정을 할 수 있다.
 * 모든 변경은 plan_review_changes에 결재권자별로 기록되어 담당자가 본다.
 *
 * 변경 후에는 계획 스냅샷·결재 금액을 재동기화한다 — 그러지 않으면 승인
 * 직후 '변경 품의 필요' 게이트가 잘못 걸린다.
 */

export type PlanReviewResult = { ok: true } | { ok: false; error: string };

type Gate =
  | {
      ok: true;
      tenantId: string;
      userId: string;
      projectId: string;
      planId: string;
    }
  | { ok: false; error: string };

/** 이 결재의 '현재 차례 결재권자' 본인인지 + 섭외계획 품의인지 확인 */
async function gate(approvalId: string): Promise<Gate> {
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

  const { data: approval } = await supabase
    .from("approvals")
    .select("id, status")
    .eq("id", approvalId)
    .maybeSingle();
  if (!approval || approval.status !== "in_progress") {
    return { ok: false, error: "결재 진행 중인 문서에서만 수정할 수 있습니다." };
  }

  // 현재 차례(pending 최소 step_order)의 결재자 본인만 — 대결자는 수정 불가
  // (대결자가 원 결재자의 이름으로 계획을 바꾸면 책임 소재가 흐려진다)
  const { data: steps } = await supabase
    .from("approval_steps")
    .select("step_order, status, approver_user_id, step_grade")
    .eq("approval_id", approvalId);
  const pending = (steps ?? []).filter((s) => s.status === "pending");
  if (pending.length === 0) {
    return { ok: false, error: "결재할 차례가 없습니다." };
  }
  const currentOrder = Math.min(...pending.map((s) => s.step_order));
  const myGrade = gradeFromUser(user);
  const myTurn = pending.some(
    (s) =>
      s.step_order === currentOrder &&
      (s.approver_user_id === user.id ||
        // 직급 릴레이 단계 (27번) — 그 직급 이상이면 지금 결재 차례다
        (s.approver_user_id === null &&
          isUserGrade(s.step_grade) &&
          myGrade !== null &&
          gradeRank(myGrade) >= gradeRank(s.step_grade)))
  );
  if (!myTurn) {
    return {
      ok: false,
      error: "지금 결재 차례인 결재권자만 계획을 수정할 수 있습니다.",
    };
  }

  const { data: plan } = await supabase
    .from("engagement_plans")
    .select("id, project_id")
    .eq("approval_id", approvalId)
    .maybeSingle();
  if (!plan) {
    return { ok: false, error: "섭외계획 품의가 아닌 문서입니다." };
  }

  return {
    ok: true,
    tenantId,
    userId: user.id,
    projectId: plan.project_id,
    planId: plan.id,
  };
}

/** 변경 후 계획·결재 금액 재동기화 — 부분 상신 계획은 커버리지 세션만 (22번) */
async function resyncPlan(approvalId: string, planId: string, projectId: string) {
  const supabase = createClient();
  const covered = await getPlanCoveredSlotIds(planId);
  const snapshot = await buildPlanSnapshot(projectId, covered ?? undefined);
  await supabase
    .from("engagement_plans")
    .update({
      planned_amount: snapshot.plannedAmount,
      position_count: snapshot.positionCount,
      slot_count: snapshot.slotCount,
      plan_signature: snapshot.signature,
    })
    .eq("id", planId);
  await supabase
    .from("approvals")
    .update({ amount: snapshot.plannedAmount })
    .eq("id", approvalId);
}

async function logChange(params: {
  tenantId: string;
  projectId: string;
  approvalId: string;
  userId: string;
  kind: "reorder" | "remove" | "fee";
  positionCode?: string | null;
  expertName?: string | null;
  before?: string | null;
  after?: string | null;
}) {
  const supabase = createClient();
  await supabase.from("plan_review_changes").insert({
    tenant_id: params.tenantId,
    project_id: params.projectId,
    approval_id: params.approvalId,
    actor_user_id: params.userId,
    change_kind: params.kind,
    position_code: params.positionCode ?? null,
    expert_name: params.expertName ?? null,
    before_text: params.before ?? null,
    after_text: params.after ?? null,
  });
}

/** 결재권자 — 세션 내 섭외 순위 변경 (드래그 결과 저장) */
export async function reviewerReorderCandidates(
  approvalId: string,
  slotId: string,
  orderedPositionIds: string[]
): Promise<PlanReviewResult> {
  const g = await gate(approvalId);
  if (!g.ok) return g;

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, rank, position_no")
    .eq("slot_id", slotId)
    .neq("status", "canceled");
  const valid = new Map((rows ?? []).map((r) => [r.id, r]));
  const ids = orderedPositionIds.filter((id) => valid.has(id));
  if (ids.length !== valid.size) {
    return { ok: false, error: "후보 목록이 갱신되었습니다. 새로고침 후 다시 시도하세요." };
  }

  const beforeOrder = (rows ?? [])
    .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no))
    .map((r) => r.code)
    .join(" → ");

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from("engagement_slot_positions")
      .update({ rank: i + 1 })
      .eq("id", id);
    if (error) return { ok: false, error: "순위 저장에 실패했습니다." };
  }

  const afterOrder = ids
    .map((id) => valid.get(id)?.code ?? "?")
    .join(" → ");
  await logChange({
    tenantId: g.tenantId,
    projectId: g.projectId,
    approvalId,
    userId: g.userId,
    kind: "reorder",
    before: beforeOrder,
    after: afterOrder,
  });
  await resyncPlan(approvalId, g.planId, g.projectId);

  revalidatePath("/[tenantSlug]/approvals/[approvalId]", "page");
  return { ok: true };
}

/** 결재권자 — 후보 삭제 (섭외가 나가기 전 후보만, 이력 보존 위해 canceled 처리) */
export async function reviewerRemoveCandidate(
  approvalId: string,
  positionId: string
): Promise<PlanReviewResult> {
  const g = await gate(approvalId);
  if (!g.ok) return g;

  const supabase = createClient();
  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, status, engagement_id, assigned_expert_id")
    .eq("id", positionId)
    .maybeSingle();
  if (
    !position ||
    position.engagement_id !== null ||
    !["open", "assigned"].includes(position.status)
  ) {
    return { ok: false, error: "이미 섭외가 진행된 후보는 삭제할 수 없습니다." };
  }

  let expertName: string | null = null;
  if (position.assigned_expert_id) {
    const { data: expert } = await supabase
      .from("experts")
      .select("name")
      .eq("id", position.assigned_expert_id)
      .maybeSingle();
    expertName = expert?.name ?? null;
  }

  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "canceled",
      assigned_expert_id: null,
      assigned_at: null,
      assigned_by: null,
    })
    .eq("id", positionId);
  if (error) return { ok: false, error: "후보 삭제에 실패했습니다." };

  await logChange({
    tenantId: g.tenantId,
    projectId: g.projectId,
    approvalId,
    userId: g.userId,
    kind: "remove",
    positionCode: position.code,
    expertName,
    before: expertName ?? "(미배정)",
    after: "후보 제외",
  });
  await resyncPlan(approvalId, g.planId, g.projectId);

  revalidatePath("/[tenantSlug]/approvals/[approvalId]", "page");
  return { ok: true };
}

/** 결재권자 — 후보 예정가 수정 */
export async function reviewerSetCandidateFee(
  approvalId: string,
  positionId: string,
  fee: string
): Promise<PlanReviewResult> {
  const g = await gate(approvalId);
  if (!g.ok) return g;
  if (!/^\d*$/.test(fee)) {
    return { ok: false, error: "예정가는 숫자만 입력하세요 (원 단위)." };
  }

  const supabase = createClient();
  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, expected_fee, assigned_expert_id")
    .eq("id", positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상 후보를 찾을 수 없습니다." };

  const nextFee = fee ? parseInt(fee, 10) : null;
  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({ expected_fee: nextFee })
    .eq("id", positionId);
  if (error) return { ok: false, error: "예정가 저장에 실패했습니다." };

  let expertName: string | null = null;
  if (position.assigned_expert_id) {
    const { data: expert } = await supabase
      .from("experts")
      .select("name")
      .eq("id", position.assigned_expert_id)
      .maybeSingle();
    expertName = expert?.name ?? null;
  }

  await logChange({
    tenantId: g.tenantId,
    projectId: g.projectId,
    approvalId,
    userId: g.userId,
    kind: "fee",
    positionCode: position.code,
    expertName,
    before:
      position.expected_fee !== null ? formatKrw(position.expected_fee) : "미정",
    after: nextFee !== null ? formatKrw(nextFee) : "미정",
  });
  await resyncPlan(approvalId, g.planId, g.projectId);

  revalidatePath("/[tenantSlug]/approvals/[approvalId]", "page");
  return { ok: true };
}
