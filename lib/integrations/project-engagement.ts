import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { projectStage, type ProjectStage } from "@/lib/integrations/project-stage";

/**
 * 프로젝트 단위 섭외 진행 — 상태 집계와 품의서 본문 구성.
 *
 * 화면(버튼 활성)과 서버 액션(실행 차단)이 **같은 함수**를 본다. 조건을 두 곳에
 * 따로 쓰면 화면은 열려 있는데 서버가 막거나, 그 반대가 된다.
 */

export type ProjectEngagementState = {
  stage: ProjectStage;
  planApprovalId: string | null;
  /** 코드넘버 총 개수 */
  total: number;
  /** 임의 배정된 자리 */
  assigned: number;
  /** 섭외 요청이 나간 자리 */
  requested: number;
  /** 수락·확정된 자리 */
  filled: number;
  /** 아직 아무도 붙지 않은 자리 */
  open: number;
  /** 배정이 100% 찼는가 — 품의 상신 가능 조건 */
  fullyAssigned: boolean;
  /** 배정 명단 기준 총 의뢰비용 (참고) */
  plannedAmount: number;
};

type PositionRow = {
  id: string;
  code: string;
  status: string;
  assigned_expert_id: string | null;
  slot_id: string;
  rank: number | null;
  position_no: number;
  expected_fee: number | null;
};

/** 프로젝트의 코드넘버 상태를 한 번에 읽는다 (RLS가 가시성을 판정) */
export async function getProjectEngagementState(
  projectId: string
): Promise<ProjectEngagementState | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, engagement_stage, engagement_plan_approval_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const { data: slots } = await supabase
    .from("engagement_slots")
    .select("id, fee_amount, required_count")
    .eq("project_id", projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  const feeBySlot = new Map((slots ?? []).map((s) => [s.id, s.fee_amount ?? 0]));

  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select(
          "id, code, status, assigned_expert_id, slot_id, rank, position_no, expected_fee"
        )
        .in("slot_id", slotIds)
    : { data: [] as PositionRow[] };

  const rows = (positions ?? []) as PositionRow[];
  const live = rows.filter((p) => p.status !== "canceled");

  const assigned = live.filter((p) => p.status === "assigned").length;
  const requested = live.filter((p) => p.status === "requested").length;
  const filled = live.filter((p) => p.status === "filled").length;
  const open = live.filter((p) => p.status === "open").length;

  // 후보 순위 모델 (개정 2026-08-22): 세션마다 후보 여러 명 중 순위 상위
  // '필요인원'명이 실제 섭외 대상이다. 금액도 그 기준으로 센다 — 예정가가
  // 없으면 세션 1인 비용(레거시) 폴백.
  const liveBySlot = new Map<string, PositionRow[]>();
  for (const p of live) {
    const list = liveBySlot.get(p.slot_id) ?? [];
    list.push(p);
    liveBySlot.set(p.slot_id, list);
  }
  let plannedAmount = 0;
  let readySlots = 0;
  for (const slot of slots ?? []) {
    const candidates = (liveBySlot.get(slot.id) ?? []).sort(
      (a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no)
    );
    const progressed = candidates.filter((c) => c.assigned_expert_id);
    const selected = progressed.slice(0, slot.required_count);
    plannedAmount += selected.reduce(
      (sum, c) => sum + (c.expected_fee ?? feeBySlot.get(slot.id) ?? 0),
      0
    );
    if (progressed.length >= slot.required_count) readySlots += 1;
  }

  return {
    stage: projectStage(project.engagement_stage),
    planApprovalId: project.engagement_plan_approval_id,
    total: live.length,
    assigned,
    requested,
    filled,
    open,
    // '전부 찼다' = 모든 세션에서 배정 후보가 필요인원 이상 (후보 슬롯이
    // 비어 있어도 된다). 세션이 하나도 없으면 아니다 — 세션부터 만들어야 한다
    fullyAssigned:
      (slots ?? []).length > 0 && readySlots === (slots ?? []).length,
    plannedAmount,
  };
}

export type PlanDraftLine = {
  sessionName: string;
  schedule: string;
  location: string;
  role: string;
  code: string;
  expertName: string;
  fee: number;
  /** 세션 내 섭외 순위 (1=최우선) */
  rank: number;
  /** 순위 상위 '필요인원'에 들어 실제 섭외·금액 대상인가 */
  selected: boolean;
};

export type PlanDraft = {
  title: string;
  body: string;
  amount: number;
  lines: PlanDraftLine[];
};

/**
 * 섭외 품의서 자동 작성.
 *
 * 담당자가 다시 타이핑할 것이 없어야 한다 — 프로젝트 기본정보와 세션별 배정
 * 명단은 이미 시스템에 다 있다. 결재자가 보고 판단할 수 있는 형태로 옮겨 적는다.
 */
export async function buildEngagementPlanDraft(
  projectId: string
): Promise<PlanDraft | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, code, business_year, client_name, starts_on, ends_on, budget_amount, description"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const { data: slots } = await supabase
    .from("engagement_slots")
    .select(
      "id, slot_date, starts_time, ends_time, session_name, role_type, role_description, fee_amount, location_name, required_count"
    )
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .order("starts_time", { ascending: true });

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select(
          "id, code, status, assigned_expert_id, expert_id, slot_id, position_no, rank, expected_fee"
        )
        .in("slot_id", slotIds)
        .order("position_no", { ascending: true })
    : { data: [] };

  const expertIds = Array.from(
    new Set(
      (positions ?? [])
        .map((p) => p.assigned_expert_id ?? p.expert_id)
        .filter((id): id is string => id !== null)
    )
  );
  const { data: experts } = expertIds.length
    ? await supabase.from("experts").select("id, name").in("id", expertIds)
    : { data: [] };
  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));

  // 후보 순위 모델 (개정 2026-08-22): 세션별로 후보를 순위순으로 나열하고,
  // 금액은 배정된 후보 중 순위 상위 '필요인원'명의 예정가 합으로 계산한다.
  const lines: PlanDraftLine[] = [];
  let amount = 0;
  for (const slot of slots ?? []) {
    const time =
      slot.starts_time && slot.ends_time
        ? ` ${slot.starts_time.slice(0, 5)}~${slot.ends_time.slice(0, 5)}`
        : "";
    const candidates = (positions ?? [])
      .filter((p) => p.slot_id === slot.id && p.status !== "canceled")
      .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no));
    let selectedCount = 0;
    candidates.forEach((position, idx) => {
      const expertId = position.assigned_expert_id ?? position.expert_id;
      const fee = position.expected_fee ?? slot.fee_amount ?? 0;
      const selected = Boolean(expertId) && selectedCount < slot.required_count;
      if (selected) {
        selectedCount += 1;
        amount += fee;
      }
      lines.push({
        sessionName:
          slot.session_name ?? roleTypeLabel(slot.role_type) ?? slot.role_type,
        schedule: `${slot.slot_date}${time}`,
        location: slot.location_name ?? "-",
        role: slot.role_description ?? roleTypeLabel(slot.role_type) ?? "-",
        code: position.code,
        expertName: expertId ? (nameById.get(expertId) ?? "-") : "(미배정)",
        fee,
        rank: idx + 1,
        selected,
      });
    });
  }

  const header = [
    `사업명: ${project.name}`,
    project.code ? `프로젝트 코드: ${project.code}` : null,
    `사업연도: ${project.business_year}`,
    project.client_name ? `발주처: ${project.client_name}` : null,
    `사업기간: ${project.starts_on ?? "?"} ~ ${project.ends_on ?? "?"}`,
    project.budget_amount !== null
      ? `사업예산: ${formatKrw(project.budget_amount)}`
      : null,
    `섭외 인원: ${lines.filter((l) => l.selected).length}명 (후보 ${lines.length}명)`,
    `계획 섭외비 합계(순위 상위 기준): ${formatKrw(amount)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const table = lines
    .map(
      (l) =>
        `${l.selected ? "★" : "예비"} ${l.rank}순위 [${l.code}] ${l.expertName} — ${l.sessionName} · ${l.schedule} · ${l.location} · ${l.role} · 예정가 ${formatKrw(l.fee)}`
    )
    .join("\n");

  const body = [
    "【 사업 개요 】",
    header,
    "",
    "【 세션별 섭외 후보 순위(안) — ★=섭외 대상, 예비=후순위 후보 】",
    table || "(배정된 인원이 없습니다)",
    "",
    "【 검토 요청 】",
    "위 배정안대로 전문가 섭외를 진행하고자 합니다. 승인 후 각 전문가에게",
    "섭외 요청을 발송하며, 최종 계약 성립은 전문가 본인의 수락으로 확정됩니다.",
    project.description ? `\n【 참고 】\n${project.description}` : "",
  ]
    .join("\n")
    .trim();

  return {
    title: `[섭외 품의] ${project.name} — 전문가 ${lines.filter((l) => l.selected).length}명`,
    body,
    amount,
    lines,
  };
}

/**
 * 섭외 품의 결재 완료 훅 — 프로젝트 단계를 넘긴다.
 *
 * 결재 화면은 프로젝트를 모른다. 승인·반려 순간에 프로젝트 단계가 따라 움직여야
 * '섭외 진행' 버튼이 열린다. 반려면 다시 배정 단계로 돌린다 — 명단을 고쳐
 * 다시 올리라는 뜻이다.
 *
 * service_role로 처리한다. 결재자가 그 프로젝트의 담당자가 아닐 수 있고
 * (대표·이사는 전사 결재), RLS로는 프로젝트를 못 고칠 수 있기 때문이다.
 */
export async function onProjectEngagementApprovalResolved(
  approvalId: string,
  outcome: "approved" | "rejected"
): Promise<void> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, engagement_stage")
    .eq("engagement_plan_approval_id", approvalId)
    .maybeSingle();
  if (!project) return;
  if (project.engagement_stage !== "plan_review") return;

  await admin
    .from("projects")
    .update({
      engagement_stage: outcome === "approved" ? "plan_approved" : "assigning",
      // 반려면 품의 연결을 끊는다 — 고쳐서 새로 올리는 것이 맞다
      engagement_plan_approval_id: outcome === "approved" ? approvalId : null,
    })
    .eq("id", project.id);
}

/**
 * 전문가 응답 후 프로젝트 단계 재판정.
 *
 * 전원이 수락하면 '수락서 송신 가능'으로, 전원이 수락서까지 확인하면 '확정'으로
 * 저절로 넘어간다. 담당자가 매번 몇 명이 남았는지 세어 보고 버튼을 눌러야 한다면
 * 그건 시스템이 할 일을 사람에게 미룬 것이다.
 *
 * 되돌아가는 경우도 처리한다 — 확정 뒤 긴급 취소가 나면 자리가 다시 비므로
 * 요청 단계로 내린다. 그래야 재섭외 버튼이 다시 열린다.
 */
export async function refreshProjectEngagementStage(
  projectId: string
): Promise<void> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, tenant_id, engagement_stage")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return;

  // 자동 전환 기록 — 담당자 행위와 무관한 시점에 배지가 바뀔 수 있으므로
  // "왜 바뀌었나"를 추적할 수 있게 남긴다 (리뷰 2c)
  const logStageChange = async (from: ProjectStage, to: ProjectStage) => {
    await admin.from("audit_logs").insert({
      tenant_id: project.tenant_id,
      actor_auth_user_id: null,
      actor_role: "system",
      action: "project.stage_auto",
      resource_type: "project",
      resource_id: projectId,
      before_data: { engagement_stage: from },
      after_data: { engagement_stage: to },
    });
  };

  const stage = projectStage(project.engagement_stage);
  // 배정·품의 단계와 종료 이후 단계는 여기서 건드리지 않는다.
  // 이 함수는 '전문가 응답에 따라 움직이는 구간'만 책임진다.
  const MANAGED: ProjectStage[] = [
    "requesting",
    "accepted_all",
    "letters_sent",
    "confirmed",
  ];
  if (!MANAGED.includes(stage)) return;

  const { data: slots } = await admin
    .from("engagement_slots")
    .select("id, required_count")
    .eq("project_id", projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  if (slotIds.length === 0) return;

  const { data: positions } = await admin
    .from("engagement_slot_positions")
    .select("slot_id, status, engagement_id")
    .in("slot_id", slotIds);

  const live = (positions ?? []).filter((p) => p.status !== "canceled");
  if (live.length === 0) return;

  // '전원 수락' = 세션마다 필요인원만큼 수락(filled)됐는가.
  // 후보 순위 모델에서는 필요인원보다 많은 예비 코드가 남아 있는 게 정상이라,
  // "모든 자리가 filled"로 재면 예비 자리 때문에 영원히 도달하지 못한다
  // (렛츠 사전 시뮬레이션 P1 — 상신 게이트·발송 대상 산정과 같은 기준으로 정렬).
  // 소급 강등 방지 (리뷰 2): 구기준(전 자리 filled)으로 이미 올라간 프로젝트가
  // 이 기준 변경 때문에 내려오면 안 된다 —
  //   · 후보를 전부 비운 세션(자체 인력 진행)은 판정에서 제외한다 (구동작 유지)
  //   · 만든 자리 수가 필요인원보다 적으면 자리 수 기준으로 잰다 (구동작 유지)
  const filledBySlot = new Map<string, number>();
  const liveBySlot = new Map<string, number>();
  for (const p of live) {
    liveBySlot.set(p.slot_id, (liveBySlot.get(p.slot_id) ?? 0) + 1);
    if (p.status === "filled") {
      filledBySlot.set(p.slot_id, (filledBySlot.get(p.slot_id) ?? 0) + 1);
    }
  }
  const allFilled = (slots ?? []).every((s) => {
    const liveCount = liveBySlot.get(s.id) ?? 0;
    if (liveCount === 0) return true;
    return (
      (filledBySlot.get(s.id) ?? 0) >= Math.min(s.required_count, liveCount)
    );
  });
  if (!allFilled) {
    // 한 자리라도 비었으면 요청 단계로 되돌린다 (긴급 취소·거절 후)
    if (stage !== "requesting") {
      await admin
        .from("projects")
        .update({ engagement_stage: "requesting" })
        .eq("id", projectId);
      await logStageChange(stage, "requesting");
    }
    return;
  }

  // 전원 확정 — 수락한(filled) 자리의 수락서가 모두 '확인 완료'면 확정까지
  // 올린다. 예비 자리의 진행 중 요청은 확정 판정에 넣지 않는다.
  const engagementIds = live
    .filter((p) => p.status === "filled")
    .map((p) => p.engagement_id)
    .filter((id): id is string => id !== null);
  const { data: acceptances } = engagementIds.length
    ? await admin
        .from("engagement_acceptances")
        .select("status")
        .in("engagement_id", engagementIds)
    : { data: [] };

  const rows = acceptances ?? [];
  const allConfirmed =
    rows.length === engagementIds.length &&
    rows.length > 0 &&
    rows.every((a) => a.status === "confirmed");
  const anySent = rows.some(
    (a) => a.status === "sent" || a.status === "signed" || a.status === "confirmed"
  );

  const next: ProjectStage = allConfirmed
    ? "confirmed"
    : anySent
      ? "letters_sent"
      : "accepted_all";

  if (next !== stage) {
    await admin
      .from("projects")
      .update({ engagement_stage: next })
      .eq("id", projectId);
    await logStageChange(stage, next);
  }
}
