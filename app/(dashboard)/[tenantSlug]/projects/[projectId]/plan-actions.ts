"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  createApprovalWithSteps,
  matchApprovalRule,
  type EngineLineStep,
} from "@/lib/approvals/engine";
import {
  buildPlanSnapshot,
  findUnreadySlots,
  getActivePlan,
  getPlanCoveredSlotIds,
  type PlanSnapshot,
} from "@/lib/integrations/engagement-plans";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import { buildLineWithFixedTail } from "@/lib/approvals/manual-line";
import {
  buildGradeRelayLine,
  isPlanRelayEnabled,
} from "@/lib/approvals/relay";

/**
 * 직접 지정 결재라인 표기 — 결재자·감사로그 열람자가 규정 라인과 구분할 수
 * 있어야 한다 (리뷰 P3-10). appliedRuleId=null만으로는 화면에서 안 보인다.
 */
const MANUAL_LINE_NOTE = "\n\n※ 결재라인 직접 지정 (전결규정 미적용)";

export type PlanActionResult =
  | { ok: true; approvalId?: string | null }
  | { ok: false; error: string };


type PlanSession = {
  ok: true;
  userId: string;
  tenantId: string;
  role: string;
} | { ok: false; error: string };

async function requirePlanSession(): Promise<PlanSession> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return {
      ok: false,
      error:
        "전자결재 모듈이 비활성 상태입니다. 이 테넌트는 계획 품의 없이 바로 섭외요청을 보냅니다.",
    };
  }
  if (!modules.operations) {
    return { ok: false, error: "프로젝트 모듈이 비활성 상태입니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("planSubmit", user))) {
    return { ok: false, error: await deniedExec("planSubmit") };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

type LineResult =
  | { ok: true; ruleId: string | null; steps: EngineLineStep[] }
  | { ok: false; error: string };

/**
 * 결재라인 결정 (기획 개정 2026-08-30 — 18번):
 * **직접 지정한 결재라인이 최우선**이다 — 상신자가 PL·PM 등 결재자를 골랐다면
 * 전결규정보다 그 선택을 따른다. 지정이 없으면 전결규정('프로젝트' 유형),
 * 그것도 없으면 직급 체계 에스컬레이션(마지막은 대표).
 */
async function resolveLine(
  amount: number,
  requesterUserId: string,
  tenantId: string,
  manualApproverIds: string[]
): Promise<LineResult> {
  const ids = Array.from(new Set(manualApproverIds.filter(Boolean)));

  // 직접 선택 (기획 개정 2026-08-30 — 30번): 상신자의 **상위 직급**만 고를
  // 수 있고, 선택과 무관하게 **상무이사·대표는 라인 끝에 고정(필수)** 이다.
  if (ids.length > 0) {
    const line = await buildLineWithFixedTail(tenantId, requesterUserId, ids);
    if (!line.ok) return line;
    return { ok: true, ruleId: null, steps: line.steps };
  }

  // 상급자 릴레이 (27번): 전자결재 메뉴에서 켠 회사는 직급 단계로 돌린다.
  // 릴레이 라인은 늘 최상위 재직 직급(상무·대표 포함)까지 올라간다.
  if (await isPlanRelayEnabled()) {
    const relay = await buildGradeRelayLine(requesterUserId);
    if (relay) return { ok: true, ruleId: null, steps: relay.steps };
  }

  // 선택이 없으면 고정 임원(상무이사 → 대표)만으로 라인을 만든다 (30번 —
  // 임원 고정이 필수라, 계획 품의는 전결규정보다 이 기본선이 먼저다).
  const fixed = await buildLineWithFixedTail(tenantId, requesterUserId, []);
  if (fixed.ok) return { ok: true, ruleId: null, steps: fixed.steps };

  // 임원 계정이 없는 회사 — 기존 폴백 유지 (규정 → 직급 에스컬레이션).
  const matched = await matchApprovalRule("project", amount);
  if (matched) {
    if (matched.steps.some((s) => s.approverUserId === requesterUserId)) {
      return {
        ok: false,
        error: "상신자 본인이 결재자로 지정된 전결규정입니다. 전결규정을 확인하세요.",
      };
    }
    return { ok: true, ruleId: matched.ruleId, steps: matched.steps };
  }
  // 상신자가 대표이고 상위 결재자가 없는 1인 기업이면 대표 자가결재로
  // 진행한다 — 그렇지 않으면 섭외를 시작할 방법 자체가 없다.
  const escalation = await buildGradeEscalationLine(requesterUserId, amount);
  if (escalation) {
    return { ok: true, ruleId: null, steps: escalation.steps };
  }
  return {
    ok: false,
    error:
      "결재선을 만들 수 없습니다 — 상위 직급·임원 계정이 없습니다. 상위 직급 계정을 추가하거나 전결규정('프로젝트' 유형)을 등록하세요.",
  };
}

/** 계획 명세(스냅샷) 저장 — JSON 블롭이 아니라 정규화 행으로 (CLAUDE.md 8) */
async function writePlanLines(
  planId: string,
  tenantId: string,
  snapshot: PlanSnapshot
): Promise<boolean> {
  const supabase = createClient();
  await supabase.from("engagement_plan_lines").delete().eq("plan_id", planId);
  if (snapshot.lines.length === 0) return true;

  const { error } = await supabase.from("engagement_plan_lines").insert(
    snapshot.lines.map((line) => ({
      tenant_id: tenantId,
      plan_id: planId,
      slot_id: line.slotId,
      slot_date: line.slotDate,
      starts_time: line.startsTime,
      ends_time: line.endsTime,
      role_type: line.roleType,
      role_description: line.roleDescription,
      required_count: line.requiredCount,
      fee_amount: line.feeAmount,
      location_name: line.locationName,
      subtotal: line.subtotal,
    }))
  );
  return !error;
}

/**
 * 상신 대상 세션의 완성 검사 (기획 확정 2026-08-30 — 22번).
 * '후보 미배정' 자리가 남았거나 배정이 필요인원에 못 미치는 세션이 있으면
 * 어느 세션이 왜 걸렸는지, 무엇을 하면 되는지를 그대로 돌려준다.
 */
async function assertSlotsReady(
  projectId: string,
  slotIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unready = await findUnreadySlots(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );
  if (unready.length === 0) return { ok: true };
  const detail = unready
    .map((s) =>
      s.unassigned > 0
        ? `${s.label} (후보 미배정 ${s.unassigned}자리)`
        : `${s.label} (배정 ${s.assignedCount}/${s.requiredCount}명)`
    )
    .join(", ");
  return {
    ok: false,
    error:
      `상신하려는 세션에 후보 미배정 항목이 남아 있습니다 (규칙): ${detail}. ` +
      `미배정 후보 자리를 삭제하거나 전문가를 배정한 뒤 다시 품의를 상신해 주세요. ` +
      `미완성 세션은 선택에서 빼고 완성된 세션만 먼저 상신할 수도 있습니다.`,
  };
}

/**
 * 섭외계획 품의 상신 (최초 또는 반려 후 재상신).
 * 현재 섭외 테이블을 그대로 계획으로 고정하고 결재라인을 붙인다.
 * slotIds를 지정하면 그 세션들만 계획에 담는다 (부분 상신 — 22번). 빈 배열 = 전체.
 */
export async function submitEngagementPlan(
  projectId: string,
  note: string,
  manualApproverIds: string[] = [],
  slotIds: string[] = []
): Promise<PlanActionResult> {
  const auth = await requirePlanSession();
  if (!auth.ok) return auth;

  const snapshot = await buildPlanSnapshot(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );
  if (snapshot.slotCount === 0) {
    return {
      ok: false,
      error: "섭외 테이블이 비어 있습니다. 타임테이블과 필요인원을 먼저 등록하세요.",
    };
  }

  const ready = await assertSlotsReady(projectId, slotIds);
  if (!ready.ok) return ready;

  const existing = await getActivePlan(projectId);
  if (existing && existing.status === "in_progress") {
    return { ok: false, error: "이미 결재가 진행중인 계획이 있습니다." };
  }
  if (existing && existing.status === "approved") {
    return {
      ok: false,
      error: "승인된 계획이 있습니다. 내용이 바뀌었다면 계획 변경 품의를 이용하세요.",
    };
  }

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const line = await resolveLine(
    snapshot.plannedAmount,
    auth.userId,
    auth.tenantId,
    manualApproverIds
  );
  if (!line.ok) return line;

  // 계획 레코드 (반려 후 재상신이면 기존 draft를 재사용)
  let planId = existing?.id ?? null;
  if (planId) {
    const { error } = await supabase
      .from("engagement_plans")
      .update({
        slot_count: snapshot.slotCount,
        position_count: snapshot.positionCount,
        planned_amount: snapshot.plannedAmount,
        plan_signature: snapshot.signature,
        note: note.trim() || null,
      })
      .eq("id", planId);
    if (error) return { ok: false, error: "계획 저장에 실패했습니다." };
  } else {
    const { data: created, error } = await supabase
      .from("engagement_plans")
      .insert({
        tenant_id: auth.tenantId,
        project_id: projectId,
        revision: 1,
        status: "draft",
        slot_count: snapshot.slotCount,
        position_count: snapshot.positionCount,
        planned_amount: snapshot.plannedAmount,
        plan_signature: snapshot.signature,
        note: note.trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "계획 생성에 실패했습니다." };
    planId = created.id;
  }

  if (!(await writePlanLines(planId, auth.tenantId, snapshot))) {
    return { ok: false, error: "계획 명세 저장에 실패했습니다." };
  }

  const approval = await createApprovalWithSteps({
    tenantId: auth.tenantId,
    requesterUserId: auth.userId,
    title: `[섭외계획] ${project.name}`,
    body:
      `섭외 인원 ${snapshot.positionCount}명 / 타임테이블 ${snapshot.slotCount}건\n` +
      `계획 섭외비 ${snapshot.plannedAmount.toLocaleString("ko-KR")}원\n\n` +
      (note.trim() || "") +
      (manualApproverIds.length > 0 ? MANUAL_LINE_NOTE : ""),
    approvalType: "project",
    amount: snapshot.plannedAmount,
    projectId,
    appliedRuleId: line.ruleId,
    steps: line.steps,
  });
  if (!approval.ok) return approval;

  const { error: linkError } = await supabase
    .from("engagement_plans")
    .update({
      status: "in_progress",
      approval_id: approval.approvalId,
      submitted_by: auth.userId,
      submitted_at: new Date().toISOString(),
      last_rejection_note: null,
    })
    .eq("id", planId);
  if (linkError) return { ok: false, error: "결재 연결에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "engagement_plan.submit",
    resource_type: "engagement_plan",
    resource_id: planId,
    after_data: {
      project_id: projectId,
      approval_id: approval.approvalId,
      planned_amount: snapshot.plannedAmount,
      position_count: snapshot.positionCount,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, approvalId: approval.approvalId };
}

/**
 * 계획 변경 품의 상신 — 승인된 계획이 있는 상태에서 섭외 테이블이 바뀐 경우.
 * 이전 계획은 유지한 채 새 리비전을 만들고, 승인되면 이전 계획이 superseded 된다.
 * 이미 확정된 섭외건은 취소하지 않는다 (취소는 별도 섭외 취소 절차).
 */
export async function submitEngagementPlanChange(
  projectId: string,
  reason: string,
  manualApproverIds: string[] = [],
  /**
   * 새 계획이 덮을 세션 (22번 — 보완 상신): 지정하면 그 세션들이 새 커버리지가
   * 된다(기존 + 추가 세션을 함께 넘긴다). 미지정 = 기존 계획의 커버리지 유지.
   */
  slotIds: string[] = []
): Promise<PlanActionResult> {
  const auth = await requirePlanSession();
  if (!auth.ok) return auth;

  if (!reason.trim()) {
    return { ok: false, error: "변경 사유를 입력하세요." };
  }

  const current = await getActivePlan(projectId);
  if (!current || current.status !== "approved") {
    return {
      ok: false,
      error: "승인된 계획이 없습니다. 최초 섭외계획 품의를 먼저 올려 주세요.",
    };
  }

  const currentCovered = await getPlanCoveredSlotIds(current.id);
  const effectiveSlotIds =
    slotIds.length > 0 ? slotIds : (currentCovered ?? []);

  const snapshot = await buildPlanSnapshot(
    projectId,
    effectiveSlotIds.length > 0 ? effectiveSlotIds : undefined
  );
  if (snapshot.signature === current.planSignature) {
    return { ok: false, error: "승인된 계획과 달라진 내용이 없습니다." };
  }

  const ready = await assertSlotsReady(projectId, effectiveSlotIds);
  if (!ready.ok) return ready;

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const line = await resolveLine(
    snapshot.plannedAmount,
    auth.userId,
    auth.tenantId,
    manualApproverIds
  );
  if (!line.ok) return line;

  // 부분 유니크 인덱스(프로젝트당 열린 계획 1건) 때문에 기존 승인 계획을 먼저 비운다
  const { error: parkError } = await supabase
    .from("engagement_plans")
    .update({ status: "superseded" })
    .eq("id", current.id);
  if (parkError) return { ok: false, error: "기존 계획 정리에 실패했습니다." };

  const revertParent = async () => {
    await supabase
      .from("engagement_plans")
      .update({ status: "approved" })
      .eq("id", current.id);
  };

  const { data: created, error: createError } = await supabase
    .from("engagement_plans")
    .insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      revision: current.revision + 1,
      status: "draft",
      parent_plan_id: current.id,
      slot_count: snapshot.slotCount,
      position_count: snapshot.positionCount,
      planned_amount: snapshot.plannedAmount,
      plan_signature: snapshot.signature,
      note: reason.trim(),
    })
    .select("id")
    .single();
  if (createError || !created) {
    await revertParent();
    return { ok: false, error: "변경 계획 생성에 실패했습니다." };
  }

  if (!(await writePlanLines(created.id, auth.tenantId, snapshot))) {
    await supabase.from("engagement_plans").delete().eq("id", created.id);
    await revertParent();
    return { ok: false, error: "계획 명세 저장에 실패했습니다." };
  }

  const diff = snapshot.plannedAmount - current.plannedAmount;
  const approval = await createApprovalWithSteps({
    tenantId: auth.tenantId,
    requesterUserId: auth.userId,
    title: `[섭외계획 변경 R${current.revision + 1}] ${project.name}`,
    body:
      `인원 ${current.positionCount}명 → ${snapshot.positionCount}명\n` +
      `계획 섭외비 ${current.plannedAmount.toLocaleString("ko-KR")}원 → ` +
      `${snapshot.plannedAmount.toLocaleString("ko-KR")}원 ` +
      `(${diff >= 0 ? "+" : ""}${diff.toLocaleString("ko-KR")}원)\n\n` +
      `변경 사유: ${reason.trim()}` +
      (manualApproverIds.length > 0 ? MANUAL_LINE_NOTE : ""),
    approvalType: "project",
    amount: snapshot.plannedAmount,
    projectId,
    appliedRuleId: line.ruleId,
    steps: line.steps,
  });
  if (!approval.ok) {
    await supabase.from("engagement_plans").delete().eq("id", created.id);
    await revertParent();
    return approval;
  }

  const { error: linkError } = await supabase
    .from("engagement_plans")
    .update({
      status: "in_progress",
      approval_id: approval.approvalId,
      submitted_by: auth.userId,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", created.id);
  if (linkError) return { ok: false, error: "결재 연결에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "engagement_plan.change_submit",
    resource_type: "engagement_plan",
    resource_id: created.id,
    before_data: {
      revision: current.revision,
      planned_amount: current.plannedAmount,
      position_count: current.positionCount,
    },
    after_data: {
      revision: current.revision + 1,
      planned_amount: snapshot.plannedAmount,
      position_count: snapshot.positionCount,
      approval_id: approval.approvalId,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
