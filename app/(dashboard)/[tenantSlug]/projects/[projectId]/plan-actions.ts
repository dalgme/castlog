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
  getActivePlan,
  type PlanSnapshot,
} from "@/lib/integrations/engagement-plans";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";

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
 * 결재라인 결정 — 전결규정('프로젝트' 유형) 우선, 없으면 지정한 결재자를 순차 라인으로.
 * 전결규정이 아직 등록되지 않은 테넌트도 계획 품의를 올릴 수 있어야 한다.
 */
async function resolveLine(
  amount: number,
  requesterUserId: string,
  tenantId: string,
  manualApproverIds: string[]
): Promise<LineResult> {
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

  const ids = Array.from(new Set(manualApproverIds.filter(Boolean)));
  if (ids.length === 0) {
    // 결재자를 고르지 않았으면 직급 체계로 위로 올린다. 상신자가 대표이고
    // 상위 결재자가 없는 1인 기업이면 대표 자가결재로 진행한다 —
    // 그렇지 않으면 섭외를 시작할 방법 자체가 없다.
    const escalation = await buildGradeEscalationLine(requesterUserId, amount);
    if (escalation) {
      return { ok: true, ruleId: null, steps: escalation.steps };
    }
    return {
      ok: false,
      error:
        "적용 가능한 전결규정이 없고 결재할 상위직급자도 없습니다. 결재자를 직접 지정하거나, 전결규정('프로젝트' 유형)을 등록하거나, 상위 직급 계정을 추가하세요.",
    };
  }
  if (ids.includes(requesterUserId)) {
    return { ok: false, error: "상신자 본인은 결재자로 지정할 수 없습니다." };
  }

  const supabase = createClient();
  const { data: found } = await supabase
    .from("users")
    .select("id")
    .in("id", ids)
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (!found || found.length !== ids.length) {
    return { ok: false, error: "결재자는 자사 소속 활성 직원이어야 합니다." };
  }

  return {
    ok: true,
    ruleId: null,
    steps: ids.map((approverUserId, index) => ({
      stepOrder: index + 1,
      stepKind: "approval" as const,
      approverUserId,
    })),
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
 * 섭외계획 품의 상신 (최초 또는 반려 후 재상신).
 * 현재 섭외 테이블을 그대로 계획으로 고정하고 결재라인을 붙인다.
 */
export async function submitEngagementPlan(
  projectId: string,
  note: string,
  manualApproverIds: string[] = []
): Promise<PlanActionResult> {
  const auth = await requirePlanSession();
  if (!auth.ok) return auth;

  const snapshot = await buildPlanSnapshot(projectId);
  if (snapshot.slotCount === 0) {
    return {
      ok: false,
      error: "섭외 테이블이 비어 있습니다. 타임테이블과 필요인원을 먼저 등록하세요.",
    };
  }

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
      (note.trim() || ""),
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
  manualApproverIds: string[] = []
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

  const snapshot = await buildPlanSnapshot(projectId);
  if (snapshot.signature === current.planSignature) {
    return { ok: false, error: "승인된 계획과 달라진 내용이 없습니다." };
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
      `변경 사유: ${reason.trim()}`,
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
