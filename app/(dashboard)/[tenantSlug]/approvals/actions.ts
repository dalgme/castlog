"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { gradeRank, isUserGrade } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import {
  approvalActSchema,
  approvalSubmitSchema,
  delegationSchema,
  ruleSaveSchema,
  type ApprovalActInput,
  type ApprovalSubmitInput,
  type DelegationInput,
  type RuleSaveInput,
} from "@/lib/approvals/schemas";
import {
  createApprovalWithSteps,
  matchApprovalRule,
  type EngineLineStep,
} from "@/lib/approvals/engine";
import { onPaymentApprovalResolved } from "@/lib/integrations/payments";
import { onProjectClosingApprovalResolved } from "@/lib/integrations/projects";
import { onEngagementPlanApprovalResolved } from "@/lib/integrations/engagement-plans";
import { PLAN_RELAY_FLAG } from "@/lib/approvals/relay";
import { createAdminClient } from "@/lib/supabase/admin";
import { onProjectEngagementApprovalResolved } from "@/lib/integrations/project-engagement";

type Session = {
  userId: string;
  tenantId: string;
  role: string;
  /** 직급 (JWT app_metadata.grade — 릴레이 단계 판정용) */
  grade: string | null;
};

async function requireApprovalsSession(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return { ok: false, error: "전자결재 모듈이 비활성화된 테넌트입니다." };
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
  return {
    ok: true,
    session: { userId: user.id, tenantId, role, grade: gradeFromUser(user) },
  };
}

/** 결재라인 입력 정합성 검사 + 결재자 테넌트 소속 확인 + 자기결재 차단 */
async function validateLineSteps(
  steps: { approverUserId: string | null }[],
  tenantId: string,
  requesterUserId?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (steps.length === 0) {
    return { ok: false, error: "결재라인을 1단계 이상 구성하세요." };
  }
  // 자기결재 방지 — 상신자는 자신을 결재자로 지정할 수 없다(상신 시점에만 검사).
  // 전결규정 정의 시점에는 상신자 맥락이 없어 건너뛴다(매칭 상신 시 여기서 걸린다).
  if (requesterUserId && steps.some((s) => s.approverUserId === requesterUserId)) {
    return { ok: false, error: "상신자 본인은 결재자로 지정할 수 없습니다." };
  }
  // 직급 릴레이 단계(approverUserId null)는 소속 검증 대상이 아니다 (27번)
  const approverIds = Array.from(
    new Set(
      steps
        .map((s) => s.approverUserId)
        .filter((v): v is string => v !== null)
    )
  );
  if (approverIds.length === 0) return { ok: true };
  const supabase = createClient();
  const { data: found } = await supabase
    .from("users")
    .select("id")
    .in("id", approverIds)
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (!found || found.length !== approverIds.length) {
    return { ok: false, error: "결재자는 자사 소속 활성 직원이어야 합니다." };
  }
  return { ok: true };
}

export type SubmitApprovalResult =
  | { ok: true; approvalId: string }
  | { ok: false; error: string };

/**
 * 품의 상신 (설계문서 9장)
 * 전결규정(approval_rules) 매칭 → 결재라인 자동 결정.
 * 매칭 규정이 없으면 수동 결재라인(manualSteps)을 사용한다.
 */
export async function submitApproval(
  input: ApprovalSubmitInput
): Promise<SubmitApprovalResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = approvalSubmitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;
  const amount = data.amount ? parseInt(data.amount, 10) : null;

  // 프로젝트 연동은 operations 모듈 활성 시에만 (CLAUDE.md 1-2-6)
  let projectId: string | null = null;
  if (data.projectId) {
    const modules = await getTenantModules();
    if (!modules.operations) {
      return { ok: false, error: "프로젝트 모듈이 비활성 상태입니다." };
    }
    projectId = data.projectId;
  }

  // 1) 전결규정 매칭 (공용 엔진) — 규정 우선, 없으면 수동 라인
  const matched = await matchApprovalRule(data.approvalType, amount);

  let appliedRuleId: string | null = null;
  let engineSteps: EngineLineStep[];
  if (matched) {
    appliedRuleId = matched.ruleId;
    engineSteps = matched.steps;
  } else if (data.manualSteps && data.manualSteps.length > 0) {
    engineSteps = data.manualSteps.map((s) => ({
      stepOrder: parseInt(s.stepOrder, 10),
      stepKind: s.stepKind,
      approverUserId: s.approverUserId,
    }));
  } else {
    return {
      ok: false,
      error:
        "적용 가능한 전결규정이 없습니다. 결재라인을 직접 지정하거나 총괄관리자에게 규정 등록을 요청하세요.",
    };
  }

  const lineCheck = await validateLineSteps(
    engineSteps,
    session.tenantId,
    session.userId
  );
  if (!lineCheck.ok) return lineCheck;

  // 2) 결재건 + 라인 생성 (공용 엔진)
  const created = await createApprovalWithSteps({
    tenantId: session.tenantId,
    requesterUserId: session.userId,
    title: data.title,
    body: data.body || null,
    approvalType: data.approvalType,
    amount,
    projectId,
    appliedRuleId,
    steps: engineSteps,
  });
  if (!created.ok) return created;

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval.submit",
    resource_type: "approval",
    resource_id: created.approvalId,
    after_data: {
      approval_type: data.approvalType,
      amount,
      applied_rule_id: appliedRuleId,
    },
  });

  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true, approvalId: created.approvalId };
}

export type ActResult = { ok: true } | { ok: false; error: string };

/**
 * 승인·반려 처리.
 * 현재 차례 = pending이 남은 가장 낮은 step_order 그룹.
 * 같은 그룹은 병렬 합의 — 전원 승인 시 다음 그룹으로, 1인이라도 반려 시 전체 반려.
 * 대결자 처리 시 원 결재자와 실제 처리자를 병기한다.
 */
export async function actOnApproval(input: ApprovalActInput): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = approvalActSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 확인하세요." };
  }
  const { approvalId, decision, comment } = parsed.data;

  const supabase = createClient();

  const { data: approval } = await supabase
    .from("approvals")
    .select("id, status, requester_user_id")
    .eq("id", approvalId)
    .maybeSingle();
  if (!approval) {
    return { ok: false, error: "결재건을 찾을 수 없습니다." };
  }
  if (approval.status !== "in_progress") {
    return { ok: false, error: "이미 종결된 결재건입니다." };
  }

  const { data: steps } = await supabase
    .from("approval_steps")
    .select("id, step_order, approver_user_id, step_grade, status")
    .eq("approval_id", approvalId)
    .order("step_order", { ascending: true });

  const allSteps = steps ?? [];
  const pendingOrders = allSteps
    .filter((s) => s.status === "pending")
    .map((s) => s.step_order);
  if (pendingOrders.length === 0) {
    return { ok: false, error: "처리할 단계가 없습니다." };
  }
  const currentOrder = Math.min(...pendingOrders);
  const currentGroup = allSteps.filter(
    (s) => s.step_order === currentOrder && s.status === "pending"
  );

  // 내 차례 판정 — 본인 결재 단계 또는 유효한 대결 대상 단계
  let myStep = currentGroup.find((s) => s.approver_user_id === session.userId);
  let delegatorId: string | null = null;
  let activeDelegatorIds: string[] = [];

  if (!myStep) {
    const { data: delegations } = await supabase
      .from("approval_delegations")
      .select("delegator_user_id, starts_on, ends_on, is_active")
      .eq("delegate_user_id", session.userId)
      .eq("is_active", true);
    const today = new Date().toISOString().slice(0, 10);
    activeDelegatorIds = Array.from(
      new Set(
        (delegations ?? [])
          .filter((d) => d.starts_on <= today && today <= d.ends_on)
          .map((d) => d.delegator_user_id)
      )
    );
    const activeDelegators = new Set(activeDelegatorIds);
    myStep = currentGroup.find(
      (s) => s.approver_user_id !== null && activeDelegators.has(s.approver_user_id)
    );
    if (myStep) delegatorId = myStep.approver_user_id;
  }

  // 직급 릴레이 단계 (기획 2026-08-30 — 27번): 지정 결재자 없이 직급으로
  // 열린 단계는 그 직급 이상의 자사 직원 누구나 처리할 수 있다.
  // 상신자 본인은 제외한다 (릴레이 단계는 늘 상신자보다 높은 직급이지만,
  // 직급이 그 사이 바뀌었을 수 있으므로 명시적으로 막는다).
  if (!myStep && session.userId !== approval.requester_user_id) {
    const myGrade = isUserGrade(session.grade) ? session.grade : null;
    const gradeSteps = currentGroup.filter(
      (s) => s.approver_user_id === null && isUserGrade(s.step_grade)
    );
    if (myGrade) {
      myStep = gradeSteps.find(
        (s) =>
          isUserGrade(s.step_grade) &&
          gradeRank(myGrade) >= gradeRank(s.step_grade)
      );
    }
    // 대결(위임)도 직급 단계에 적용한다 — 마지막 단계는 늘 최상위 직급이라
    // 대결이 안 먹히면 대표 부재 시 완전 교착이 된다 (리뷰 P2-3).
    // 위임자가 상신자 본인이면 제외 (대리 자기결재 방지).
    if (!myStep && gradeSteps.length > 0 && activeDelegatorIds.length > 0) {
      const { data: delegatorRows } = await supabase
        .from("users")
        .select("id, grade")
        .in("id", activeDelegatorIds)
        .eq("is_active", true);
      for (const step of gradeSteps) {
        const grade = step.step_grade;
        if (!isUserGrade(grade)) continue;
        const delegator = (delegatorRows ?? []).find(
          (u) =>
            u.id !== approval.requester_user_id &&
            isUserGrade(u.grade) &&
            gradeRank(u.grade) >= gradeRank(grade)
        );
        if (delegator) {
          myStep = step;
          delegatorId = delegator.id;
          break;
        }
      }
    }
  }

  if (!myStep) {
    return { ok: false, error: "현재 처리 차례가 아니거나 처리 권한이 없습니다." };
  }

  const nowIso = new Date().toISOString();
  const newStepStatus = decision === "approve" ? "approved" : "rejected";

  // 행수 확인(CAS) — 릴레이 단계는 같은 차례가 여러 상급자에게 동시에 열려
  // 경합이 실제로 난다. 0행이면 이미 다른 결재권자가 처리한 것 (리뷰 P2-2)
  const { data: actedRow, error: stepError } = await supabase
    .from("approval_steps")
    .update({
      status: newStepStatus,
      acted_by_user_id: session.userId, // 대결 시 원 결재자(approver)와 병기
      acted_at: nowIso,
      comment: comment || null,
    })
    .eq("id", myStep.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (stepError) {
    return { ok: false, error: "처리에 실패했습니다 (시스템 오류). 다시 시도해 주세요." };
  }
  if (!actedRow) {
    return {
      ok: false,
      error:
        "이미 다른 결재권자가 이 단계를 처리했습니다 (규칙). 새로고침 후 진행 상황을 확인해 주세요.",
    };
  }

  // 결재건 상태 전이 + 연동 훅 (지급 배치 등 — lib/integrations에 격리)
  if (decision === "reject") {
    await supabase
      .from("approvals")
      .update({ status: "rejected", completed_at: nowIso })
      .eq("id", approvalId);
    await onPaymentApprovalResolved(approvalId, "rejected", comment || null);
    await onProjectClosingApprovalResolved(approvalId, "rejected");
    await onEngagementPlanApprovalResolved(approvalId, "rejected", comment || null);
    await onProjectEngagementApprovalResolved(approvalId, "rejected");
  } else {
    const remainingInGroup = currentGroup.filter((s) => s.id !== myStep.id).length;
    const laterPending = allSteps.some(
      (s) => s.step_order > currentOrder && s.status === "pending"
    );
    if (remainingInGroup === 0 && !laterPending) {
      await supabase
        .from("approvals")
        .update({ status: "approved", completed_at: nowIso })
        .eq("id", approvalId);
      await onPaymentApprovalResolved(approvalId, "approved", null);
      await onProjectClosingApprovalResolved(approvalId, "approved");
      await onEngagementPlanApprovalResolved(approvalId, "approved", null);
      await onProjectEngagementApprovalResolved(approvalId, "approved");
    }
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: decision === "approve" ? "approval.approve" : "approval.reject",
    resource_type: "approval",
    resource_id: approvalId,
    after_data: {
      step_id: myStep.id,
      delegated_for: delegatorId, // null이면 본인 처리
    },
  });

  revalidatePath("/[tenantSlug]/approvals", "page");
  revalidatePath(`/[tenantSlug]/approvals/${approvalId}`, "page");
  return { ok: true };
}

/** 상신 취소 — 아무도 처리하지 않은 진행중 건만, 상신자 본인 */
export async function cancelApproval(approvalId: string): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: approval } = await supabase
    .from("approvals")
    .select("id, status, requester_user_id")
    .eq("id", approvalId)
    .maybeSingle();

  if (!approval || approval.requester_user_id !== session.userId) {
    return { ok: false, error: "취소 권한이 없습니다." };
  }
  if (approval.status !== "in_progress") {
    return { ok: false, error: "진행중인 결재건만 취소할 수 있습니다." };
  }

  const { data: actedSteps } = await supabase
    .from("approval_steps")
    .select("id")
    .eq("approval_id", approvalId)
    .neq("status", "pending")
    .limit(1);
  if (actedSteps && actedSteps.length > 0) {
    return { ok: false, error: "이미 결재가 시작되어 취소할 수 없습니다." };
  }

  await supabase
    .from("approvals")
    .update({ status: "canceled", completed_at: new Date().toISOString() })
    .eq("id", approvalId);

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval.cancel",
    resource_type: "approval",
    resource_id: approvalId,
  });

  revalidatePath("/[tenantSlug]/approvals", "page");
  revalidatePath(`/[tenantSlug]/approvals/${approvalId}`, "page");
  return { ok: true };
}

export type ResubmitResult =
  | { ok: true; approvalId: string }
  | { ok: false; error: string };

/** 반려 후 재상신 — 새 결재건 생성 + 원 결재건 연결 (이력 추적) */
export async function resubmitApproval(
  approvalId: string
): Promise<ResubmitResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: original } = await supabase
    .from("approvals")
    .select(
      "id, status, requester_user_id, title, body, approval_type, amount, project_id, applied_rule_id"
    )
    .eq("id", approvalId)
    .maybeSingle();

  if (!original || original.requester_user_id !== session.userId) {
    return { ok: false, error: "재상신 권한이 없습니다." };
  }
  if (original.status !== "rejected") {
    return { ok: false, error: "반려된 결재건만 재상신할 수 있습니다." };
  }

  // step_grade 포함 — 릴레이 단계(approver null)를 빼고 복사하면
  // actor_present 제약에 걸려 재상신이 반드시 실패한다 (리뷰 P2-1)
  const { data: originalSteps } = await supabase
    .from("approval_steps")
    .select("step_order, step_kind, approver_user_id, step_grade")
    .eq("approval_id", approvalId)
    .order("step_order", { ascending: true });

  const { data: created, error: createError } = await supabase
    .from("approvals")
    .insert({
      tenant_id: session.tenantId,
      title: original.title,
      body: original.body,
      approval_type: original.approval_type,
      amount: original.amount,
      project_id: original.project_id,
      requester_user_id: session.userId,
      resubmitted_from_id: original.id,
      applied_rule_id: original.applied_rule_id,
    })
    .select("id")
    .single();

  if (createError || !created) {
    return { ok: false, error: "재상신에 실패했습니다." };
  }

  const { error: stepsError } = await supabase.from("approval_steps").insert(
    (originalSteps ?? []).map((s) => ({
      tenant_id: session.tenantId,
      approval_id: created.id,
      step_order: s.step_order,
      step_kind: s.step_kind,
      approver_user_id: s.approver_user_id,
      step_grade: s.step_grade,
    }))
  );

  if (stepsError) {
    await supabase
      .from("approvals")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .eq("id", created.id);
    return { ok: false, error: "결재라인 복사에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval.resubmit",
    resource_type: "approval",
    resource_id: created.id,
    after_data: { resubmitted_from: original.id },
  });

  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true, approvalId: created.id };
}

/**
 * 전결규정 저장 — baseRuleId가 있으면 개정(새 버전 행 + 구 버전 비활성).
 * 개정 이력은 행으로 보존된다 (CLAUDE.md 14-5).
 */
export async function saveApprovalRule(input: RuleSaveInput): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;
  // 대표 또는 '전결규정' 위임자 (requireAdminScope가 대표를 포함한다)
  const ruleGate = await requireAdminScope("approvals");
  if (!ruleGate.ok) {
    return { ok: false, error: "전결규정 관리 권한이 없습니다." };
  }

  const parsed = ruleSaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const minAmount = data.minAmount ? parseInt(data.minAmount, 10) : null;
  const maxAmount = data.maxAmount ? parseInt(data.maxAmount, 10) : null;
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    return { ok: false, error: "금액 구간이 올바르지 않습니다 (최소 ≤ 최대)." };
  }

  const lineCheck = await validateLineSteps(data.steps, session.tenantId);
  if (!lineCheck.ok) return lineCheck;

  const supabase = createClient();

  let version = 1;
  if (data.baseRuleId) {
    const { data: base } = await supabase
      .from("approval_rules")
      .select("id, version")
      .eq("id", data.baseRuleId)
      .maybeSingle();
    if (!base) {
      return { ok: false, error: "개정 대상 규정을 찾을 수 없습니다." };
    }
    version = base.version + 1;
  }

  const { data: rule, error: ruleError } = await supabase
    .from("approval_rules")
    .insert({
      tenant_id: session.tenantId,
      name: data.name,
      approval_type: data.approvalType || null,
      min_amount: minAmount,
      max_amount: maxAmount,
      priority: parseInt(data.priority, 10),
      version,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (ruleError || !rule) {
    return { ok: false, error: "규정 저장에 실패했습니다." };
  }

  const { error: stepsError } = await supabase.from("approval_rule_steps").insert(
    data.steps.map((s) => ({
      tenant_id: session.tenantId,
      rule_id: rule.id,
      step_order: parseInt(s.stepOrder, 10),
      step_kind: s.stepKind,
      approver_user_id: s.approverUserId,
    }))
  );

  if (stepsError) {
    await supabase.from("approval_rules").delete().eq("id", rule.id);
    return { ok: false, error: "결재라인 저장에 실패했습니다." };
  }

  if (data.baseRuleId) {
    await supabase
      .from("approval_rules")
      .update({ is_active: false, superseded_by_id: rule.id })
      .eq("id", data.baseRuleId);
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: data.baseRuleId ? "approval_rule.revise" : "approval_rule.create",
    resource_type: "approval_rule",
    resource_id: rule.id,
    after_data: { version, superseded: data.baseRuleId || null },
  });

  revalidatePath("/[tenantSlug]/approvals/rules", "page");
  return { ok: true };
}

/** 전결규정 비활성화 (폐지) — 이력 행은 보존 */
export async function deactivateApprovalRule(ruleId: string): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;
  // 대표 또는 '전결규정' 위임자 (requireAdminScope가 대표를 포함한다)
  const ruleGate = await requireAdminScope("approvals");
  if (!ruleGate.ok) {
    return { ok: false, error: "전결규정 관리 권한이 없습니다." };
  }

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("approval_rules")
    .update({ is_active: false })
    .eq("id", ruleId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "규정 비활성화에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval_rule.deactivate",
    resource_type: "approval_rule",
    resource_id: ruleId,
  });

  revalidatePath("/[tenantSlug]/approvals/rules", "page");
  return { ok: true };
}

/**
 * 상급자 릴레이 결재 스위치 (기획 확정 2026-08-30 — 27번).
 * 켜면 섭외계획 품의(최초·변경)가 직급 단계 결재선으로 상신된다 —
 * 각 단계는 그 직급 이상 누구나 결재, 결재 시 다음 상급 직급 자동 진행.
 * 대표 또는 '전결규정' 위임자만 바꿀 수 있다 (결재 경로를 바꾸는 운영 설정).
 */
export async function setPlanRelayEnabled(enabled: boolean): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;
  const gate = await requireAdminScope("approvals");
  if (!gate.ok) {
    return { ok: false, error: "전자결재 설정 권한이 없습니다 (권한 규칙 — 대표 또는 '전결규정' 위임자)." };
  }

  const admin = createAdminClient();
  // 읽기-수정-쓰기 경합 방지 — 다른 feature_flags 쓰기와 겹칠 수 있다 (CAS 3회)
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags, updated_at")
      .eq("id", session.tenantId)
      .maybeSingle();
    if (!tenant) return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };
    const priorFlags =
      tenant.feature_flags !== null &&
      typeof tenant.feature_flags === "object" &&
      !Array.isArray(tenant.feature_flags)
        ? (tenant.feature_flags as Record<string, unknown>)
        : {};
    if (priorFlags[PLAN_RELAY_FLAG] === true === enabled) {
      saved = true;
      break;
    }
    let updateQuery = admin
      .from("tenants")
      .update({
        feature_flags: { ...priorFlags, [PLAN_RELAY_FLAG]: enabled },
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.tenantId);
    updateQuery = tenant.updated_at
      ? updateQuery.eq("updated_at", tenant.updated_at)
      : updateQuery.is("updated_at", null);
    const { data: updated, error } = await updateQuery.select("id");
    if (error) return { ok: false, error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
    saved = (updated ?? []).length > 0;
  }
  if (!saved) {
    return { ok: false, error: "다른 설정 변경과 겹쳤습니다. 잠시 후 다시 시도해 주세요." };
  }

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: enabled ? "approval.relay_on" : "approval.relay_off",
    resource_type: "tenant",
    resource_id: session.tenantId,
  });

  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true };
}

/** 대결·위임 설정 — 위임자 본인 */
export async function createDelegation(input: DelegationInput): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = delegationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  if (parsed.data.delegateUserId === session.userId) {
    return { ok: false, error: "본인을 대결자로 지정할 수 없습니다." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("approval_delegations").insert({
    tenant_id: session.tenantId,
    delegator_user_id: session.userId,
    delegate_user_id: parsed.data.delegateUserId,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    reason: parsed.data.reason || null,
  });

  if (error) {
    return { ok: false, error: "대결 설정에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval_delegation.create",
    resource_type: "approval_delegation",
    after_data: {
      delegate: parsed.data.delegateUserId,
      period: `${parsed.data.startsOn}~${parsed.data.endsOn}`,
    },
  });

  revalidatePath("/[tenantSlug]/approvals/delegations", "page");
  return { ok: true };
}

/** 대결·위임 종료 */
export async function endDelegation(delegationId: string): Promise<ActResult> {
  const auth = await requireApprovalsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("approval_delegations")
    .update({ is_active: false })
    .eq("id", delegationId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "대결 종료에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "approval_delegation.end",
    resource_type: "approval_delegation",
    resource_id: delegationId,
  });

  revalidatePath("/[tenantSlug]/approvals/delegations", "page");
  return { ok: true };
}
