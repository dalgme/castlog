import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 결재 생성 공용 엔진 (approvals 모듈)
 * 수동 상신(품의 화면)과 연동 자동 상신(지급 일괄 품의 등)이 공유한다.
 * 호출자는 세션 클라이언트 권한(RLS) 안에서 동작한다.
 */

export type EngineLineStep = {
  stepOrder: number;
  stepKind: "approval" | "agreement";
  /** 지정 결재자 — 직급 릴레이 단계(stepGrade)면 null (기획 2026-08-30 — 27번) */
  approverUserId: string | null;
  /** 직급 릴레이 단계 — 그 직급 이상 누구나 결재. named 단계면 없음 */
  stepGrade?: string | null;
};

/** 전결규정 매칭 — priority 높은 순, 유형·금액 구간 일치 (CLAUDE.md 7) */
export async function matchApprovalRule(
  approvalType: string,
  amount: number | null
): Promise<{ ruleId: string; steps: EngineLineStep[] } | null> {
  const supabase = createClient();

  const { data: rules } = await supabase
    .from("approval_rules")
    .select("id, approval_type, min_amount, max_amount, priority")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  const matched = (rules ?? []).find((rule) => {
    if (rule.approval_type && rule.approval_type !== approvalType) return false;
    if (rule.min_amount !== null && (amount === null || amount < rule.min_amount)) {
      return false;
    }
    if (rule.max_amount !== null && (amount === null || amount > rule.max_amount)) {
      return false;
    }
    return true;
  });

  if (!matched) return null;

  const { data: ruleSteps } = await supabase
    .from("approval_rule_steps")
    .select("step_order, step_kind, approver_user_id")
    .eq("rule_id", matched.id)
    .order("step_order", { ascending: true });

  const steps: EngineLineStep[] = (ruleSteps ?? []).map((s) => ({
    stepOrder: s.step_order,
    stepKind: s.step_kind === "agreement" ? "agreement" : "approval",
    approverUserId: s.approver_user_id,
  }));

  if (steps.length === 0) return null;
  return { ruleId: matched.id, steps };
}

export type CreateApprovalParams = {
  tenantId: string;
  requesterUserId: string;
  title: string;
  body: string | null;
  approvalType: string;
  amount: number | null;
  projectId: string | null;
  appliedRuleId: string | null;
  steps: EngineLineStep[];
  resubmittedFromId?: string | null;
  /**
   * 문서 성격 (38번): decision(기본, 승인/반려가 상태를 움직임) |
   * report(사후보고 — 확인/피드백만, 되돌리지 않음)
   */
  approvalKind?: "decision" | "report";
};

/** 결재건 + 결재라인 생성 — 라인 생성 실패 시 결재건은 취소 처리 */
export async function createApprovalWithSteps(
  params: CreateApprovalParams
): Promise<{ ok: true; approvalId: string } | { ok: false; error: string }> {
  const supabase = createClient();

  const base = {
    tenant_id: params.tenantId,
    title: params.title,
    body: params.body,
    approval_type: params.approvalType,
    amount: params.amount,
    project_id: params.projectId,
    requester_user_id: params.requesterUserId,
    applied_rule_id: params.appliedRuleId,
    resubmitted_from_id: params.resubmittedFromId ?? null,
  };
  const kind = params.approvalKind ?? "decision";
  let { data: approval, error: approvalError } = await supabase
    .from("approvals")
    .insert({ ...base, approval_kind: kind })
    .select("id")
    .single();
  // approval_kind 컬럼 미적용 환경(42703)은 기본 문서로 폴백 — 단, 사후보고는
  // 컬럼 없이 만들면 '결재'로 오인되므로 폴백하지 않는다 (§14-10)
  if (approvalError?.code === "42703" && kind === "decision") {
    ({ data: approval, error: approvalError } = await supabase
      .from("approvals")
      .insert(base)
      .select("id")
      .single());
  }

  if (approvalError || !approval) {
    return {
      ok: false,
      error:
        approvalError?.code === "42703"
          ? "사후보고 문서 컬럼이 아직 적용되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션 적용을 요청하세요."
          : "상신에 실패했습니다. 다시 시도해 주세요.",
    };
  }

  const { error: stepsError } = await supabase.from("approval_steps").insert(
    params.steps.map((s) => ({
      tenant_id: params.tenantId,
      approval_id: approval.id,
      step_order: s.stepOrder,
      step_kind: s.stepKind,
      approver_user_id: s.approverUserId,
      step_grade: s.stepGrade ?? null,
    }))
  );

  if (stepsError) {
    await supabase
      .from("approvals")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .eq("id", approval.id);
    return { ok: false, error: "결재라인 생성에 실패했습니다. 다시 시도해 주세요." };
  }

  return { ok: true, approvalId: approval.id };
}
