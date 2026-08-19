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
    .select("id, fee_amount")
    .eq("project_id", projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  const feeBySlot = new Map((slots ?? []).map((s) => [s.id, s.fee_amount ?? 0]));

  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select("id, code, status, assigned_expert_id, slot_id")
        .in("slot_id", slotIds)
    : { data: [] as PositionRow[] };

  const rows = (positions ?? []) as PositionRow[];
  const live = rows.filter((p) => p.status !== "canceled");

  const assigned = live.filter((p) => p.status === "assigned").length;
  const requested = live.filter((p) => p.status === "requested").length;
  const filled = live.filter((p) => p.status === "filled").length;
  const open = live.filter((p) => p.status === "open").length;

  // 배정 명단 금액 — 세션의 1인당 비용을 자리 수만큼 더한다
  const plannedAmount = live
    .filter((p) => p.status !== "open")
    .reduce((sum, p) => sum + (feeBySlot.get(p.slot_id) ?? 0), 0);

  return {
    stage: projectStage(project.engagement_stage),
    planApprovalId: project.engagement_plan_approval_id,
    total: live.length,
    assigned,
    requested,
    filled,
    open,
    // 자리가 하나도 없으면 '전부 찼다'가 아니다 — 세션부터 만들어야 한다
    fullyAssigned: live.length > 0 && open === 0,
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
      "id, slot_date, starts_time, ends_time, session_name, role_type, role_description, fee_amount, location_name"
    )
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .order("starts_time", { ascending: true });

  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select("id, code, status, assigned_expert_id, expert_id, slot_id, position_no")
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

  const lines: PlanDraftLine[] = [];
  for (const slot of slots ?? []) {
    const time =
      slot.starts_time && slot.ends_time
        ? ` ${slot.starts_time.slice(0, 5)}~${slot.ends_time.slice(0, 5)}`
        : "";
    for (const position of positions ?? []) {
      if (position.slot_id !== slot.id) continue;
      if (position.status === "canceled") continue;
      const expertId = position.assigned_expert_id ?? position.expert_id;
      lines.push({
        sessionName:
          slot.session_name ?? roleTypeLabel(slot.role_type) ?? slot.role_type,
        schedule: `${slot.slot_date}${time}`,
        location: slot.location_name ?? "-",
        role: slot.role_description ?? roleTypeLabel(slot.role_type) ?? "-",
        code: position.code,
        expertName: expertId ? (nameById.get(expertId) ?? "-") : "(미배정)",
        fee: slot.fee_amount ?? 0,
      });
    }
  }

  const amount = lines.reduce((sum, l) => sum + l.fee, 0);

  const header = [
    `사업명: ${project.name}`,
    project.code ? `프로젝트 코드: ${project.code}` : null,
    `사업연도: ${project.business_year}`,
    project.client_name ? `발주처: ${project.client_name}` : null,
    `사업기간: ${project.starts_on ?? "?"} ~ ${project.ends_on ?? "?"}`,
    project.budget_amount !== null
      ? `사업예산: ${formatKrw(project.budget_amount)}`
      : null,
    `섭외 인원: ${lines.length}명`,
    `섭외비 합계: ${formatKrw(amount)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const table = lines
    .map(
      (l, i) =>
        `${i + 1}. [${l.code}] ${l.expertName} — ${l.sessionName} · ${l.schedule} · ${l.location} · ${l.role} · ${formatKrw(l.fee)}`
    )
    .join("\n");

  const body = [
    "【 사업 개요 】",
    header,
    "",
    "【 세션별 전문가 배정(안) 】",
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
    title: `[섭외 품의] ${project.name} — 전문가 ${lines.length}명`,
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
