import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 섭외계획 품의 (operations ↔ approvals — CLAUDE.md 1-2-6)
 *
 * 섭외 테이블(TO·역할·비용)을 계획으로 고정해 결재를 받고, 승인된 계획이 있어야
 * 섭외요청을 보낼 수 있게 하는 게이트. 승인 후 섭외 테이블이 바뀌면(TO 증감·비용
 * 변경 등) 지문(plan_signature)이 달라지므로 변경 품의를 요구한다.
 *
 * approvals 모듈이 비활성인 테넌트에서는 게이트를 적용하지 않는다 (1-2-4 단독 경로).
 */

export type PlanStatus =
  | "draft"
  | "in_progress"
  | "approved"
  | "rejected"
  | "superseded";

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "작성중",
  in_progress: "결재 진행중",
  approved: "승인",
  rejected: "반려",
  superseded: "대체됨",
};

export type PlanLine = {
  slotId: string;
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  roleDescription: string | null;
  requiredCount: number;
  feeAmount: number;
  locationName: string | null;
  subtotal: number;
  /** 지문용 — 상위 후보(코드:전문가:예정가:순위) 목록. 저장 대상 아님 */
  candidateSignature?: string;
};

export type PlanSnapshot = {
  lines: PlanLine[];
  slotCount: number;
  positionCount: number;
  plannedAmount: number;
  signature: string;
};

/**
 * 현재 섭외 테이블에서 계획 스냅샷을 만든다 (후보 순위 모델 — 개정 2026-08-22).
 *
 * 세션마다 후보(임시후보 코드)가 여러 명이고 각자 예정가를 갖는다. 계획 금액은
 * **섭외 순위 상위 '필요인원'명(배정된 후보 기준)의 예정가 합**이다 — 후보
 * 전원의 합이 아니다(실제 섭외 예정 인원 기준). 예정가가 비어 있으면 세션의
 * 1인 비용(레거시)으로 폴백한다.
 *
 * 지문에는 상위 후보들의 (코드|전문가|예정가|순위)까지 넣는다 — 결재 중
 * 결재권자가 순위·금액·후보를 바꾸면 지문이 달라지므로, 그 변경 후에는
 * 계획 레코드를 재동기화해야 한다 (plan-review-actions가 수행).
 */
export async function buildPlanSnapshot(
  projectId: string
): Promise<PlanSnapshot> {
  const supabase = createClient();
  const { data: slots } = await supabase
    .from("engagement_slots")
    .select(
      "id, slot_date, starts_time, ends_time, role_type, role_description, required_count, fee_amount, location_name"
    )
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .order("starts_time", { ascending: true });

  type CandidateRow = {
    id: string;
    slot_id: string;
    code: string;
    position_no: number;
    rank: number | null;
    expected_fee: number | null;
    status: string;
    assigned_expert_id: string | null;
  };
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select(
          "id, slot_id, code, position_no, rank, expected_fee, status, assigned_expert_id"
        )
        .in("slot_id", slotIds)
        .neq("status", "canceled")
    : { data: [] as CandidateRow[] };

  const bySlot = new Map<string, CandidateRow[]>();
  for (const p of positions ?? []) {
    const list = bySlot.get(p.slot_id) ?? [];
    list.push(p);
    bySlot.set(p.slot_id, list);
  }

  const lines: PlanLine[] = (slots ?? []).map((slot) => {
    const legacyFee = slot.fee_amount ?? 0;
    const candidates = (bySlot.get(slot.id) ?? []).sort(
      (a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no)
    );
    // 섭외 대상 = 배정된 후보 중 순위 상위 '필요인원'명
    const selected = candidates
      .filter((c) => c.assigned_expert_id)
      .slice(0, slot.required_count);
    const subtotal = selected.reduce(
      (sum, c) => sum + (c.expected_fee ?? legacyFee),
      0
    );
    return {
      slotId: slot.id,
      slotDate: slot.slot_date,
      startsTime: slot.starts_time,
      endsTime: slot.ends_time,
      roleType: slot.role_type,
      roleDescription: slot.role_description,
      requiredCount: slot.required_count,
      feeAmount: legacyFee,
      locationName: slot.location_name,
      subtotal,
      candidateSignature: selected
        .map(
          (c) =>
            `${c.code}:${c.assigned_expert_id ?? ""}:${c.expected_fee ?? legacyFee}:${c.rank ?? c.position_no}`
        )
        .join(","),
    };
  });

  const signature = lines
    .map((l) =>
      [
        l.slotDate,
        l.startsTime ?? "",
        l.endsTime ?? "",
        l.roleType,
        l.requiredCount,
        l.subtotal,
        l.candidateSignature,
      ].join("|")
    )
    .sort()
    .join(";");

  return {
    lines,
    slotCount: lines.length,
    positionCount: lines.reduce((sum, l) => sum + l.requiredCount, 0),
    plannedAmount: lines.reduce((sum, l) => sum + l.subtotal, 0),
    signature,
  };
}

export type ActivePlan = {
  id: string;
  revision: number;
  status: PlanStatus;
  approvalId: string | null;
  slotCount: number;
  positionCount: number;
  plannedAmount: number;
  planSignature: string;
  note: string | null;
  lastRejectionNote: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
};

/** 프로젝트의 현재 유효 계획 (draft/in_progress/approved 중 1건) */
export async function getActivePlan(
  projectId: string
): Promise<ActivePlan | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("engagement_plans")
    .select(
      "id, revision, status, approval_id, slot_count, position_count, planned_amount, plan_signature, note, last_rejection_note, submitted_at, approved_at"
    )
    .eq("project_id", projectId)
    .in("status", ["draft", "in_progress", "approved"])
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    revision: data.revision,
    status: data.status as PlanStatus,
    approvalId: data.approval_id,
    slotCount: data.slot_count,
    positionCount: data.position_count,
    plannedAmount: data.planned_amount,
    planSignature: data.plan_signature,
    note: data.note,
    lastRejectionNote: data.last_rejection_note,
    submittedAt: data.submitted_at,
    approvedAt: data.approved_at,
  };
}

export type PlanGate =
  | { required: false; reason: "module_off" }
  | {
      required: true;
      allowed: boolean;
      state:
        | "none" // 계획 미상신
        | "in_progress" // 결재 진행중
        | "rejected" // 반려 — 수정 후 재상신 필요
        | "approved" // 승인 — 섭외요청 가능
        | "changed"; // 승인 후 섭외 테이블 변경 — 변경 품의 필요
      plan: ActivePlan | null;
      message: string;
    };

/**
 * 섭외요청 가능 여부 판정. approvals 모듈이 꺼져 있으면 게이트 자체가 없다.
 * 화면 표시와 서버 액션 차단에 같은 함수를 쓴다.
 */
export async function evaluatePlanGate(
  projectId: string,
  approvalsEnabled: boolean
): Promise<PlanGate> {
  if (!approvalsEnabled) return { required: false, reason: "module_off" };

  const [plan, snapshot] = await Promise.all([
    getActivePlan(projectId),
    buildPlanSnapshot(projectId),
  ]);

  if (!plan) {
    return {
      required: true,
      allowed: false,
      state: "none",
      plan: null,
      message:
        "섭외계획 품의가 상신되지 않았습니다. 섭외 테이블을 확정한 뒤 계획 품의를 올려 주세요.",
    };
  }

  if (plan.status === "in_progress") {
    return {
      required: true,
      allowed: false,
      state: "in_progress",
      plan,
      message: "섭외계획 품의가 결재 진행중입니다. 승인 후 섭외요청을 보낼 수 있습니다.",
    };
  }

  if (plan.status === "draft") {
    return {
      required: true,
      allowed: false,
      state: plan.lastRejectionNote ? "rejected" : "none",
      plan,
      message: plan.lastRejectionNote
        ? `섭외계획 품의가 반려되었습니다. 사유: ${plan.lastRejectionNote}`
        : "섭외계획 품의를 상신해 주세요.",
    };
  }

  // approved — 승인 이후 섭외 테이블이 바뀌었는지 대조
  if (plan.planSignature !== snapshot.signature) {
    return {
      required: true,
      allowed: false,
      state: "changed",
      plan,
      message:
        "승인된 계획과 현재 섭외 테이블이 다릅니다(인원·비용·일정 변경). 계획 변경 품의를 올린 뒤 진행해 주세요.",
    };
  }

  return {
    required: true,
    allowed: true,
    state: "approved",
    plan,
    message: `섭외계획 승인 완료 (리비전 ${plan.revision}).`,
  };
}

/**
 * 섭외요청 서버 액션의 공용 가드.
 * 진행 중인 섭외건(이미 요청된 포지션)에는 적용하지 않는다 — 신규 송신만 막는다.
 */
export async function assertEngagementAllowed(
  projectId: string | null,
  approvalsEnabled: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 프로젝트에 연결되지 않은 단건 섭외는 계획 대상이 아니다
  if (!projectId) return { ok: true };

  const gate = await evaluatePlanGate(projectId, approvalsEnabled);
  if (!gate.required || gate.allowed) return { ok: true };
  return { ok: false, error: gate.message };
}

/**
 * 섭외계획 품의 ↔ 결재 연동 훅.
 * 결재 도메인은 계획 도메인을 알지 않는다 — 결재 종결 시 여기서 상태를 맞춘다.
 *  - 승인 → status='approved' + 승인 시점 지문 확정
 *  - 반려 → status='draft' 복귀 + 반려 사유 기록 (수정 후 재상신 가능)
 */
export async function onEngagementPlanApprovalResolved(
  approvalId: string,
  outcome: "approved" | "rejected",
  rejectionNote: string | null
): Promise<void> {
  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("engagement_plans")
    .select("id, tenant_id, project_id, status, parent_plan_id")
    .eq("approval_id", approvalId)
    .maybeSingle();

  if (!plan || plan.status !== "in_progress") return;

  if (outcome === "approved") {
    await admin
      .from("engagement_plans")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", plan.id);
    // 변경 품의였다면 이전 계획을 대체 처리
    if (plan.parent_plan_id) {
      await admin
        .from("engagement_plans")
        .update({ status: "superseded" })
        .eq("id", plan.parent_plan_id);
    }
  } else {
    await admin
      .from("engagement_plans")
      .update({
        status: "draft",
        approval_id: null,
        last_rejection_note: rejectionNote ?? "반려됨 (사유 미기재)",
      })
      .eq("id", plan.id);
  }

  await admin.from("audit_logs").insert({
    tenant_id: plan.tenant_id,
    actor_auth_user_id: null, // 시스템 동기화 (결재 행위 로그는 별도 존재)
    actor_role: "system",
    action:
      outcome === "approved"
        ? "engagement_plan.approved"
        : "engagement_plan.rejected",
    resource_type: "engagement_plan",
    resource_id: plan.id,
    after_data: { approval_id: approvalId, project_id: plan.project_id },
  });
}
