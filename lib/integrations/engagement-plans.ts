import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { getTenantModules } from "@/lib/modules/server";

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
  projectId: string,
  /**
   * 세션(슬롯) 부분 선택 (기획 확정 2026-08-30 — 22번): 지정하면 그 세션들만
   * 계획에 담는다. 미지정(undefined)·빈 배열 = 전체 (기존 동작).
   */
  onlySlotIds?: string[]
): Promise<PlanSnapshot> {
  const supabase = createClient();
  const { data: allSlots } = await supabase
    .from("engagement_slots")
    .select(
      "id, slot_date, starts_time, ends_time, role_type, role_description, required_count, fee_amount, location_name"
    )
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .order("starts_time", { ascending: true });
  const slots =
    onlySlotIds && onlySlotIds.length > 0
      ? (allSlots ?? []).filter((s) => onlySlotIds.includes(s.id))
      : allSlots;

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

export type PlanSignatureCandidate = {
  code: string;
  expertId: string | null;
  fee: number;
  rank: number;
};

/**
 * 계획 지문(plan_signature)에서 상신·승인 시점의 섭외 대상(코드·전문가·예정가·
 * 순위)을 되읽는다. 지문은 buildPlanSnapshot이 만든 형식 그대로다:
 *   line := date|starts|ends|roleType|required|subtotal|cands
 *   cands := code:expertId:fee:rank[,…]   lines는 ';'로 이어진다.
 * 결재된 금액을 화면에 보여 주는 근거 — 현재 예정가는 그 뒤 바뀌었을 수 있다.
 */
export type PlanSignatureLine = {
  /** 세션 명세와 맞추는 열쇠 — date|starts|ends|roleType|required|subtotal */
  key: string;
  candidates: PlanSignatureCandidate[];
};

/** engagement_plan_lines 한 행의 열쇠 — 지문 line의 앞 6필드와 같은 형식 */
export function planLineKey(line: {
  slot_date: string;
  starts_time: string | null;
  ends_time: string | null;
  role_type: string;
  required_count: number;
  subtotal: number;
}): string {
  return [
    line.slot_date,
    line.starts_time ?? "",
    line.ends_time ?? "",
    line.role_type,
    line.required_count,
    line.subtotal,
  ].join("|");
}

export function parsePlanSignatureCandidates(
  signature: string | null | undefined
): PlanSignatureLine[] {
  const out: PlanSignatureLine[] = [];
  if (!signature) return out;
  for (const line of signature.split(";")) {
    if (!line) continue;
    const fields = line.split("|");
    const key = fields.slice(0, 6).join("|");
    const candidates: PlanSignatureCandidate[] = [];
    for (const c of (fields[6] ?? "").split(",")) {
      if (!c) continue;
      const [code, expertId, fee, rank] = c.split(":");
      if (!code) continue;
      candidates.push({
        code,
        expertId: expertId || null,
        fee: Number(fee) || 0,
        rank: Number(rank) || 0,
      });
    }
    out.push({ key, candidates });
  }
  return out;
}

/**
 * 계획이 덮는 세션(슬롯) 집합 (기획 확정 2026-08-30 — 22번).
 * 별도 컬럼 없이 계획 명세(engagement_plan_lines)의 slot_id에서 파생한다 —
 * 명세가 진실이고, 레거시(전체 상신) 계획도 그대로 맞는다.
 * 반환 null = 명세에 slot_id가 하나도 없는 아주 옛 계획 — 전체로 간주.
 */
export async function getPlanCoveredSlotIds(
  planId: string
): Promise<string[] | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("engagement_plan_lines")
    .select("slot_id")
    .eq("plan_id", planId);
  const ids = (data ?? [])
    .map((l) => l.slot_id)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return null;
  // 세션이 지워져 slot_id가 비면(on delete set null) 그 행은 '전체'가 아니라
  // '없어진 세션'이다 — 남은 행만 커버리지로 본다. 살아 있는 계획의 세션 삭제는
  // deleteSlot이 막지만, 반려·대체 계획은 막지 않는다 (E2E 검수 P2-7)
  return Array.from(new Set(ids));
}

export type UnreadySlot = {
  slotId: string;
  label: string;
  /** 후보 미배정(전문가가 붙지 않은) 자리 수 */
  unassigned: number;
  assignedCount: number;
  requiredCount: number;
};

/**
 * 상신하려는 세션의 완성 여부 검사 (기획 확정 2026-08-30 — 22번).
 * 배정 인원이 필요인원에 못 미치는 세션을 돌려준다.
 *
 * 빈 후보 TO(전문가가 붙지 않은 자리)는 상신을 막지 않는다 (E2E 검수 P2-4):
 * 세션을 만들면 TO가 필요인원의 3배수로 자동 발급되므로, 빈 TO를 지워야만
 * 품의가 올라간다면 첫 상신마다 청소부터 해야 한다. 빈 TO는 계획에 실리지
 * 않고(buildPlanSnapshot이 배정 후보만 담는다) 예비 후보 자리로 남는다.
 */
export async function findUnreadySlots(
  projectId: string,
  onlySlotIds?: string[]
): Promise<UnreadySlot[]> {
  const supabase = createClient();
  const { data: allSlots } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, session_name, role_type, required_count")
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true });
  const slots =
    onlySlotIds && onlySlotIds.length > 0
      ? (allSlots ?? []).filter((s) => onlySlotIds.includes(s.id))
      : (allSlots ?? []);
  if (slots.length === 0) return [];

  const { data: positions } = await supabase
    .from("engagement_slot_positions")
    .select("slot_id, status, assigned_expert_id")
    .in(
      "slot_id",
      slots.map((s) => s.id)
    )
    .neq("status", "canceled");

  const result: UnreadySlot[] = [];
  for (const slot of slots) {
    const rows = (positions ?? []).filter((p) => p.slot_id === slot.id);
    const assignedCount = rows.filter((p) => p.assigned_expert_id).length;
    const unassigned = rows.length - assignedCount;
    if (assignedCount < slot.required_count) {
      result.push({
        slotId: slot.id,
        label: `${slot.slot_date} ${slot.session_name ?? slot.role_type}`,
        unassigned,
        assignedCount,
        requiredCount: slot.required_count,
      });
    }
  }
  return result;
}

export type ActivePlan = {
  id: string;
  revision: number;
  status: PlanStatus;
  approvalId: string | null;
  parentPlanId: string | null;
  slotCount: number;
  positionCount: number;
  plannedAmount: number;
  planSignature: string;
  note: string | null;
  lastRejectionNote: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  /** 38번 — 사후보고로 확정된 계획 (컬럼 미적용 환경은 null) */
  flow: "pre_approval" | "post_report" | null;
};

const ACTIVE_PLAN_COLUMNS =
  "id, tenant_id, revision, status, approval_id, parent_plan_id, slot_count, position_count, planned_amount, plan_signature, note, last_rejection_note, submitted_at, approved_at";

type ActivePlanRow = {
  id: string;
  tenant_id: string;
  revision: number;
  status: string;
  approval_id: string | null;
  parent_plan_id: string | null;
  slot_count: number;
  position_count: number;
  planned_amount: number;
  plan_signature: string;
  note: string | null;
  last_rejection_note: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  flow?: string | null;
};

function toActivePlan(row: ActivePlanRow): ActivePlan {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status as PlanStatus,
    approvalId: row.approval_id,
    parentPlanId: row.parent_plan_id,
    slotCount: row.slot_count,
    positionCount: row.position_count,
    plannedAmount: row.planned_amount,
    planSignature: row.plan_signature,
    note: row.note,
    lastRejectionNote: row.last_rejection_note,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    flow:
      row.flow === "post_report" || row.flow === "pre_approval" ? row.flow : null,
  };
}

/**
 * 프로젝트의 살아 있는 계획들 (다중 — 기획 지시 2026-09-05).
 * draft(반려 뒤 수정 대기)·in_progress·approved. 세션 묶음마다 계획이 따로
 * 있을 수 있다 — 같은 세션이 두 살아 있는 계획에 담기지 않는 것만 DB 트리거
 * (app.guard_engagement_plan_slot_overlap)가 보장한다. 최신 리비전이 먼저.
 */
export async function getLivePlans(projectId: string): Promise<ActivePlan[]> {
  const supabase = createClient();
  const withFlow = await supabase
    .from("engagement_plans")
    .select(`${ACTIVE_PLAN_COLUMNS}, flow`)
    .eq("project_id", projectId)
    .in("status", ["draft", "in_progress", "approved"])
    .order("revision", { ascending: false });
  let rows: ActivePlanRow[] = (withFlow.data ?? []) as ActivePlanRow[];
  if (isMissingColumnError(withFlow.error)) {
    // flow 컬럼 미적용 환경 (§14-10 부재 폴백)
    const withoutFlow = await supabase
      .from("engagement_plans")
      .select(ACTIVE_PLAN_COLUMNS)
      .eq("project_id", projectId)
      .in("status", ["draft", "in_progress", "approved"])
      .order("revision", { ascending: false });
    rows = (withoutFlow.data ?? []) as ActivePlanRow[];
  }

  // 자가 치유: 결재건이 취소·반려됐는데 계획만 in_progress로 남은 행은 살아
  // 있는 계획이 아니다 (배포 경계에서 훅이 안 돈 경우 — 렛츠 보고 2026-09-05).
  // 화면이 이런 행을 '결재 중'으로 잠그면 사용자는 풀 방법이 없다.
  const inProgressApprovalIds = rows
    .filter((r) => r.status === "in_progress" && r.approval_id)
    .map((r) => r.approval_id as string);
  if (inProgressApprovalIds.length > 0) {
    const { data: approvalRows } = await supabase
      .from("approvals")
      .select("id, status")
      .in("id", inProgressApprovalIds);
    const dead = new Set(
      (approvalRows ?? [])
        .filter((a) => a.status === "canceled")
        .map((a) => a.id)
    );
    if (dead.size > 0) {
      const admin = createAdminClient();
      for (const r of rows) {
        if (r.status !== "in_progress" || !r.approval_id || !dead.has(r.approval_id)) continue;
        await admin
          .from("engagement_plans")
          .update({ status: "superseded" })
          .eq("id", r.id)
          .eq("status", "in_progress");
        await admin.from("audit_logs").insert({
          tenant_id: r.tenant_id,
          actor_auth_user_id: null,
          actor_role: "system",
          action: "engagement_plan.withdrawn",
          resource_type: "engagement_plan",
          resource_id: r.id,
          after_data: { approval_id: r.approval_id, reason: "self-heal: approval canceled" },
        });
      }
      rows = rows.filter(
        (r) => !(r.status === "in_progress" && r.approval_id && dead.has(r.approval_id))
      );
    }
  }
  return rows.map(toActivePlan);
}

/** 세션 하나가 계획 품의에서 어디까지 왔는가 */
export type SlotPlanState =
  | "none" // 어느 살아 있는 계획에도 없음 — 상신 가능
  | "in_progress" // 결재 진행중 계획에 담김
  | "rejected" // 반려된 계획(draft)에 담김 — 수정 후 재상신
  | "approved" // 승인 계획에 담김 — 섭외요청 가능
  | "changed"; // 승인 뒤 내용이 바뀜 — 변경 품의 필요

export const SLOT_PLAN_STATE_LABELS: Record<SlotPlanState, string> = {
  none: "품의 미포함",
  in_progress: "결재 중",
  rejected: "반려 · 재상신 필요",
  approved: "승인",
  changed: "변경 품의 필요",
};

/** 세션 단위 상태 설명 — 요청 화면·실패 문구 공용 (§12-9) */
export function describeSlotPlanState(state: SlotPlanState): string {
  switch (state) {
    case "approved":
      return "승인된 섭외계획에 담긴 세션입니다. 섭외요청을 보낼 수 있습니다.";
    case "in_progress":
      return "이 세션의 섭외계획 품의가 결재 진행중입니다 (상태 미충족). 승인되면 섭외요청을 보낼 수 있습니다.";
    case "changed":
      return "승인된 계획과 이 세션의 현재 내용(인원·비용·일정)이 다릅니다 (규칙). 섭외계획 패널에서 그 계획의 변경 품의를 올린 뒤 진행해 주세요.";
    case "rejected":
      return "이 세션이 담긴 섭외계획 품의가 반려되었습니다 (규칙). 내용을 조정한 뒤 '섭외 품의서 자동 작성 및 송신'으로 다시 상신해 주세요.";
    case "none":
    default:
      return "이 세션은 아직 어떤 섭외계획 품의에도 담기지 않았습니다 (규칙). '섭외 품의서 자동 작성 및 송신'에서 이 세션을 골라 상신하고 승인받은 뒤 진행해 주세요.";
  }
}

/** 살아 있는 계획 하나의 판정 결과 */
export type LivePlanView = {
  plan: ActivePlan;
  /** draft = 한 번도 결재에 오르지 않은 임시 행(상신 실패 잔재) */
  state: "in_progress" | "rejected" | "approved" | "changed" | "draft";
  /** 계획이 덮는 세션 — null = 전체(세션 구분 없는 옛 계획) */
  coveredSlotIds: string[] | null;
  message: string;
};

export type PlanGate =
  | { required: false; reason: "module_off" }
  | {
      required: true;
      /** 승인돼 발송 가능한 계획이 하나라도 있는가 */
      allowed: boolean;
      /**
       * 대표 상태 (프로젝트 배지·요약 문구): approved > changed > in_progress
       * > rejected > none. 세션별 판정은 slotStates가 진실이다.
       */
      state:
        | "none" // 계획 미상신
        | "in_progress" // 결재 진행중
        | "rejected" // 반려 — 수정 후 재상신 필요
        | "approved" // 승인 — 섭외요청 가능
        | "changed"; // 승인 후 섭외 테이블 변경 — 변경 품의 필요
      /** 대표 계획 (승인 우선) */
      plan: ActivePlan | null;
      message: string;
      /**
       * 발송 가능 커버리지 = 승인(미변경) 계획들의 세션 합집합.
       * null = 전체(세션 구분 없는 옛 승인 계획이 있음). 계획이 없으면 [].
       */
      coveredSlotIds: string[] | null;
      /** 살아 있는 계획 전부 (최신 리비전 먼저) */
      plans: LivePlanView[];
      /** 세션 → 상태 (프로젝트의 모든 세션) */
      slotStates: Record<string, SlotPlanState>;
      /** 어느 살아 있는 계획에도 없는 세션 — 새 품의로 상신할 수 있다 */
      uncoveredSlotIds: string[];
    };

/**
 * 섭외요청 가능 여부 판정 — 세션 단위 (다중 계획, 2026-09-05).
 * approvals 모듈이 꺼져 있으면 게이트 자체가 없다.
 * 화면 표시와 서버 액션 차단이 같은 함수를 쓴다.
 */
export async function evaluatePlanGate(
  projectId: string,
  approvalsEnabled: boolean
): Promise<PlanGate> {
  if (!approvalsEnabled) return { required: false, reason: "module_off" };

  const supabase = createClient();
  const [plans, { data: slotRows }] = await Promise.all([
    getLivePlans(projectId),
    supabase
      .from("engagement_slots")
      .select("id")
      .eq("project_id", projectId),
  ]);
  const allSlotIds = (slotRows ?? []).map((s) => s.id);

  const views: LivePlanView[] = [];
  for (const plan of plans) {
    const coveredSlotIds = await getPlanCoveredSlotIds(plan.id);
    if (plan.status === "in_progress") {
      views.push({
        plan,
        state: "in_progress",
        coveredSlotIds,
        message: `리비전 ${plan.revision} — 결재 진행중입니다. 승인 후 담긴 세션의 섭외요청을 보낼 수 있습니다.`,
      });
      continue;
    }
    if (plan.status === "draft") {
      views.push({
        plan,
        state: plan.lastRejectionNote ? "rejected" : "draft",
        coveredSlotIds,
        message: plan.lastRejectionNote
          ? `리비전 ${plan.revision} — 반려되었습니다. 사유: ${plan.lastRejectionNote}`
          : `리비전 ${plan.revision} — 상신되지 않은 임시 계획입니다.`,
      });
      continue;
    }
    // approved — 승인 이후 '계획에 담긴 세션'이 바뀌었는지 대조.
    // 계획 밖 세션의 추가·수정은 변경으로 치지 않는다.
    const snapshot = await buildPlanSnapshot(projectId, coveredSlotIds ?? undefined);
    if (plan.planSignature !== snapshot.signature) {
      views.push({
        plan,
        state: "changed",
        coveredSlotIds,
        message: `리비전 ${plan.revision} — 승인된 계획과 현재 섭외 테이블이 다릅니다(인원·비용·일정 변경). 변경 품의를 올린 뒤 진행해 주세요.`,
      });
    } else {
      views.push({
        plan,
        state: "approved",
        coveredSlotIds,
        message: `리비전 ${plan.revision} — 승인 완료. 담긴 세션의 섭외요청을 보낼 수 있습니다.`,
      });
    }
  }

  // 세션별 판정 — 살아 있는 계획이 세션을 나눠 갖는다. 겹침은 DB가 막지만
  // 옛 전체 계획(null)과 공존하는 예외는 승인 > 결재중 > 반려 순으로 고른다
  const rank: Record<LivePlanView["state"], number> = {
    approved: 5,
    changed: 4,
    in_progress: 3,
    rejected: 2,
    draft: 1,
  };
  const slotStates: Record<string, SlotPlanState> = {};
  for (const slotId of allSlotIds) {
    let best: LivePlanView | null = null;
    for (const v of views) {
      const covers = v.coveredSlotIds === null || v.coveredSlotIds.includes(slotId);
      if (!covers) continue;
      if (!best || rank[v.state] > rank[best.state]) best = v;
    }
    slotStates[slotId] =
      !best || best.state === "draft" ? "none" : best.state;
  }
  const uncoveredSlotIds = allSlotIds.filter((id) => slotStates[id] === "none");

  const approvedViews = views.filter((v) => v.state === "approved");
  const coveredSlotIds: string[] | null = approvedViews.some(
    (v) => v.coveredSlotIds === null
  )
    ? null
    : Array.from(
        new Set(approvedViews.flatMap((v) => v.coveredSlotIds ?? []))
      );

  const representative =
    approvedViews[0] ??
    views.find((v) => v.state === "changed") ??
    views.find((v) => v.state === "in_progress") ??
    views.find((v) => v.state === "rejected") ??
    null;
  const state: Extract<PlanGate, { required: true }>["state"] =
    representative === null || representative.state === "draft"
      ? "none"
      : representative.state;

  const counts = {
    approved: approvedViews.length,
    changed: views.filter((v) => v.state === "changed").length,
    inProgress: views.filter((v) => v.state === "in_progress").length,
    rejected: views.filter((v) => v.state === "rejected").length,
  };
  const summary = [
    counts.approved > 0 ? `승인 ${counts.approved}건` : null,
    counts.changed > 0 ? `변경 품의 필요 ${counts.changed}건` : null,
    counts.inProgress > 0 ? `결재 중 ${counts.inProgress}건` : null,
    counts.rejected > 0 ? `반려 ${counts.rejected}건` : null,
    uncoveredSlotIds.length > 0 ? `미상신 세션 ${uncoveredSlotIds.length}개` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const message =
    views.length === 0
      ? "섭외계획 품의가 상신되지 않았습니다. 세션별 후보를 배정한 뒤 '섭외 품의서 자동 작성 및 송신'으로 계획 품의를 올려 주세요."
      : counts.approved > 0
        ? `섭외계획 ${summary}. 승인된 세션의 섭외요청을 보낼 수 있습니다.`
        : counts.inProgress > 0
          ? `섭외계획 ${summary}. 결재가 끝나면 그 세션의 섭외요청을 보낼 수 있습니다. 미상신 세션은 지금도 별도 품의로 올릴 수 있습니다.`
          : `섭외계획 ${summary}. 내용을 조정한 뒤 다시 상신해 주세요.`;

  return {
    required: true,
    allowed: approvedViews.length > 0,
    state,
    plan: representative?.plan ?? null,
    message,
    coveredSlotIds,
    plans: views,
    slotStates,
    uncoveredSlotIds,
  };
}

/**
 * 후보·순위·예정가·필요인원 편집 가드 — 세션 단위 (E2E 검수 P2-9).
 * 화면 잠금(워크벤치: 결재 중·승인·변경 필요 세션은 편집 불가)과 같은 기준을
 * 서버에서 강제한다. 결재 중에 명단이 바뀌면 결재권자가 승인한 것과 실제가
 * 어긋난다. 승인 뒤 조정은 그 계획의 변경 품의(결재권자 편집·세션 편집)로만.
 */
export async function assertSlotEditable(
  slotId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("project_id")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return { ok: true }; // 존재 여부는 호출자가 판정한다
  const modules = await getTenantModules();
  const gate = await evaluatePlanGate(slot.project_id, modules.approvals);
  if (!gate.required) return { ok: true };
  const state = gate.slotStates[slotId] ?? "none";
  if (state === "in_progress" || state === "approved" || state === "changed") {
    return {
      ok: false,
      error:
        `이 세션은 섭외계획이 '${SLOT_PLAN_STATE_LABELS[state]}' 상태라 후보·순위·예정가·필요인원을 편집할 수 없습니다 (규칙). ` +
        (state === "in_progress"
          ? "결재가 끝나거나 결재건을 상신 취소한 뒤 조정하세요."
          : "조정이 필요하면 섭외계획 패널에서 해당 계획의 변경 품의를 올리세요."),
    };
  }
  return { ok: true };
}

/**
 * 섭외요청 서버 액션의 공용 가드 — 세션 단위.
 * 진행 중인 섭외건(이미 요청된 포지션)에는 적용하지 않는다 — 신규 송신만 막는다.
 */
export async function assertEngagementAllowed(
  projectId: string | null,
  approvalsEnabled: boolean,
  /** 요청이 속한 세션 — 그 세션이 승인 계획에 담겨 있어야 통과 (22번·다중 계획) */
  slotId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 프로젝트에 연결되지 않은 단건 섭외는 계획 대상이 아니다
  if (!projectId) return { ok: true };

  const gate = await evaluatePlanGate(projectId, approvalsEnabled);
  if (!gate.required) return { ok: true };
  if (slotId) {
    const state = gate.slotStates[slotId] ?? "none";
    if (state === "approved") return { ok: true };
    return { ok: false, error: describeSlotPlanState(state) };
  }
  if (!gate.allowed) return { ok: false, error: gate.message };
  return { ok: true };
}

/**
 * 사후보고 피드백 훅 (38번) — 상급자가 보고 문서에 '피드백'을 남기면 계획에
 * 문구만 기록한다. 계획·프로젝트 단계는 **되돌리지 않는다** (이미 문자가
 * 나갔을 수 있다). 담당자 화면(섭외 진행 탭·프로젝트 배너)이 이 문구를 보여 준다.
 */
export async function onEngagementReportFeedback(
  approvalId: string,
  feedback: string,
  /** 남긴 사람 — 여러 단계(팀장·임원)의 피드백이 누적되므로 누가 썼는지 붙인다 */
  actorName: string | null
): Promise<void> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("engagement_plans")
    .select("id, tenant_id, project_id, feedback_note")
    .eq("approval_id", approvalId)
    .maybeSingle();
  if (!plan) return;

  const line = `${actorName ? `[${actorName}] ` : ""}${feedback || "(내용 미기재)"}`;
  const merged = plan.feedback_note ? `${plan.feedback_note}\n${line}` : line;
  const { error } = await admin
    .from("engagement_plans")
    .update({ feedback_note: merged })
    .eq("id", plan.id);
  if (error && !isMissingColumnError(error)) {
    console.error("engagement report feedback update failed:", error.message);
  }

  await admin.from("audit_logs").insert({
    tenant_id: plan.tenant_id,
    actor_auth_user_id: null,
    actor_role: "system",
    action: "engagement_plan.feedback",
    resource_type: "engagement_plan",
    resource_id: plan.id,
    after_data: { approval_id: approvalId, project_id: plan.project_id },
  });
}

/**
 * 상신 취소(회수) 훅 — 상신자가 결재건을 취소하면 계획도 따라 내려온다.
 * 계획이 in_progress로 남으면 담긴 세션이 '결재 중'으로 잠긴 채 영영 풀리지
 * 않는다 (렛츠 보고 2026-09-05). 변경 품의였다면 부모 승인 계획을 되살린다.
 */
export async function onEngagementPlanApprovalCanceled(
  approvalId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("engagement_plans")
    .select("id, tenant_id, project_id, status, parent_plan_id")
    .eq("approval_id", approvalId)
    .maybeSingle();
  if (!plan || plan.status !== "in_progress") return;

  // 회수한 계획은 이력으로만 남긴다 — 세션은 즉시 편집·재상신이 열린다
  await admin
    .from("engagement_plans")
    .update({ status: "superseded" })
    .eq("id", plan.id);
  if (plan.parent_plan_id) {
    await admin
      .from("engagement_plans")
      .update({ status: "approved" })
      .eq("id", plan.parent_plan_id)
      .eq("status", "superseded");
  }

  await admin.from("audit_logs").insert({
    tenant_id: plan.tenant_id,
    actor_auth_user_id: null,
    actor_role: "system",
    action: "engagement_plan.withdrawn",
    resource_type: "engagement_plan",
    resource_id: plan.id,
    after_data: { approval_id: approvalId, project_id: plan.project_id },
  });
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
  } else if (plan.parent_plan_id) {
    // 변경·보완 품의의 반려 — 이미 승인된 부모 계획을 되살린다. 부모를 죽인
    // 채 자식만 draft로 두면 승인됐던 세션의 발송까지 막히고 재상신 창구도
    // 없어진다 (E2E 검수 P1-1). 자식은 이력으로만 남긴다(rejected — 부분
    // 유니크 인덱스 밖이라 부모 복원과 충돌하지 않는다).
    await admin
      .from("engagement_plans")
      .update({
        status: "rejected",
        last_rejection_note: rejectionNote ?? "반려됨 (사유 미기재)",
      })
      .eq("id", plan.id);
    await admin
      .from("engagement_plans")
      .update({ status: "approved" })
      .eq("id", plan.parent_plan_id)
      .eq("status", "superseded");
  } else {
    // approval_id는 지우지 않는다 — 결재 상세가 "이 결재건은 섭외계획 품의다"를
    // 알아야 고아 재상신을 막을 수 있고(E2E 검수 P2-5), 패널의 '결재건 보기'가
    // 반려 사유로 이어진다. 재상신 시 finalizePlanRecord가 새 결재건으로 덮는다.
    await admin
      .from("engagement_plans")
      .update({
        status: "draft",
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
