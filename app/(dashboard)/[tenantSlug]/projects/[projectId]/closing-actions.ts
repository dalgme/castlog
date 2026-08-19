"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import { getTenantModules } from "@/lib/modules/server";
import { matchApprovalRule, createApprovalWithSteps } from "@/lib/approvals/engine";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import {
  getProjectSettlement,
  buildSettlementDocument,
} from "@/lib/integrations/project-settlement";
import { projectStage } from "@/lib/integrations/project-stage";

export type ClosingActionResult = { ok: true } | { ok: false; error: string };

type Session = { userId: string; tenantId: string; role: string };

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireManager(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "프로젝트 마감 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

/**
 * 지급품의서를 볼 수 있는 사람 = 지급을 다룰 수 있는 사람이다.
 *
 * 금액 전체가 한 화면에 모이는 문서이므로 프로젝트 담당자라는 이유로 열리면
 * 안 된다. 판정은 지급 화면과 같은 함수(canManagePayments)를 쓴다 — 회계담당관
 * (finance 위임)과 임원(이사) 이상. 두 곳에 따로 쓰면 언젠가 어긋난다.
 */

/** 프로젝트 종료 절차 시작 — 참여율·만족도 입력 화면을 연다 */
export async function startProjectClosing(
  projectId: string
): Promise<ClosingActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, engagement_stage")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const stage = projectStage(project.engagement_stage);
  if (stage !== "confirmed") {
    return {
      ok: false,
      error:
        stage === "closing" || stage === "settlement_review" || stage === "settled"
          ? "이미 종료 절차가 시작되었습니다."
          : "전원 확정 후에 종료할 수 있습니다.",
    };
  }

  const { error } = await supabase
    .from("projects")
    .update({ engagement_stage: "closing" })
    .eq("id", projectId);
  if (error) return { ok: false, error: "종료 절차를 시작하지 못했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "project.closing_start",
    resource_type: "project",
    resource_id: projectId,
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 세션별 전문가 만족도 저장 (0~100, 5점 단위) + 메모.
 *
 * 기존 10점 평가(score)와 같은 테이블에 쓴다. score는 not null이므로 만족도에서
 * 환산해 함께 넣는다 — 전문가 검색의 평균 점수가 이 값을 그대로 쓰기 때문에,
 * 마감 평가를 하면 검색 화면의 점수도 같이 최신이 된다.
 */
export async function saveSessionSatisfaction(input: {
  projectId: string;
  expertId: string;
  slotId: string | null;
  satisfaction: number;
  memo?: string;
}): Promise<ClosingActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const value = Math.round(input.satisfaction);
  if (!Number.isFinite(value) || value < 0 || value > 100 || value % 5 !== 0) {
    return { ok: false, error: "만족도는 0~100 사이의 5점 단위로 입력하세요." };
  }
  if ((input.memo ?? "").length > 1000) {
    return { ok: false, error: "메모는 1000자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  // 10점 환산 — 0점도 최저 1점으로 저장한다 (score는 1~10 제약)
  const score = Math.max(1, Math.round(value / 10));
  const memo = input.memo?.trim() || null;

  // (프로젝트·전문가·세션) 한 건. upsert 대신 조회 후 갱신 — 유니크 키가
  // coalesce 식 인덱스라 onConflict 컬럼 목록으로는 지정할 수 없다.
  const lookup = supabase
    .from("expert_evaluations")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("expert_id", input.expertId);
  const { data: found } = await (input.slotId
    ? lookup.eq("slot_id", input.slotId)
    : lookup.is("slot_id", null)
  ).maybeSingle();

  if (found) {
    const { error } = await supabase
      .from("expert_evaluations")
      .update({
        satisfaction: value,
        score,
        memo,
        evaluator_user_id: auth.session.userId,
      })
      .eq("id", found.id);
    if (error) return { ok: false, error: "평가 저장에 실패했습니다." };
  } else {
    const { error } = await supabase.from("expert_evaluations").insert({
      tenant_id: auth.session.tenantId,
      project_id: input.projectId,
      expert_id: input.expertId,
      slot_id: input.slotId,
      satisfaction: value,
      score,
      memo,
      evaluator_user_id: auth.session.userId,
    });
    if (error) return { ok: false, error: "평가 저장에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 지급 품의 검토 요청 — 회계담당자에게 넘긴다.
 *
 * 참여율 100%와 전 건 만족도 입력이 조건이다. 둘 다 '나중에 채우자'가 되면
 * 회계담당자가 빈칸이 섞인 내역으로 지급을 판단하게 된다.
 */
export async function requestSettlementReview(
  projectId: string
): Promise<ClosingActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const settlement = await getProjectSettlement(projectId);
  if (!settlement) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (settlement.stage !== "closing") {
    return {
      ok: false,
      error:
        settlement.stage === "confirmed"
          ? "먼저 ‘프로젝트 종료’를 시작하세요."
          : "이미 검토 요청이 올라갔습니다.",
    };
  }
  if (settlement.contributionTotal !== 100) {
    return {
      ok: false,
      error: `참여율 합계가 100%가 아닙니다 (현재 ${settlement.contributionTotal}%).`,
    };
  }
  if (settlement.unratedCount > 0) {
    return {
      ok: false,
      error: `만족도가 입력되지 않은 참여 건이 ${settlement.unratedCount}건 있습니다.`,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({ engagement_stage: "settlement_review" })
    .eq("id", projectId);
  if (error) return { ok: false, error: "검토 요청에 실패했습니다." };

  await supabase.from("tenant_alerts").insert({
    tenant_id: auth.session.tenantId,
    severity: "info",
    category: "settlement_review",
    title: `지급 품의 검토 요청 — ${settlement.projectName}`,
    // 금액은 넣지 않는다 — 전사에 보일 수 있는 텍스트다. 숫자는 지급 화면에서 본다
    body: `참여 전문가 ${settlement.expertCount}명. 회계담당자의 지급품의서 검토가 필요합니다.`,
    resource_type: "project",
    resource_id: projectId,
    created_by: auth.session.userId,
  });

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "project.settlement_review_request",
    resource_type: "project",
    resource_id: projectId,
    after_data: {
      expert_count: settlement.expertCount,
      total_gross: settlement.totalGross,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 지급품의서 내용 확인 완료 → 종료 및 지급 품의서 송신.
 *
 * 회계담당자가 확인을 누르는 순간 품의서가 나간다. '확인'과 '상신'을 두 번
 * 누르게 하지 않는다 — 확인한 뒤 상신을 잊으면 지급이 멈춘다.
 */
export async function confirmSettlementReview(input: {
  projectId: string;
  note?: string;
}): Promise<ClosingActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!(await canManagePayments())) {
    return {
      ok: false,
      error: "지급품의서는 회계담당자와 임원 이상만 확인할 수 있습니다.",
    };
  }
  if ((input.note ?? "").length > 2000) {
    return { ok: false, error: "검토 메모는 2000자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "권한을 확인할 수 없습니다." };
  }

  const settlement = await getProjectSettlement(input.projectId);
  if (!settlement) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (settlement.stage !== "settlement_review") {
    return {
      ok: false,
      error:
        settlement.stage === "settled"
          ? "이미 지급 품의가 송신되었습니다."
          : "담당자의 검토 요청 후에 확인할 수 있습니다.",
    };
  }

  const note = input.note?.trim() || null;
  const document = buildSettlementDocument({ ...settlement, settlementNote: note });

  const modules = await getTenantModules();
  const now = new Date().toISOString();

  // approvals 비활성 — 결재 절차가 없는 회사는 확인으로 종결한다 (단독 동작 경로)
  if (!modules.approvals) {
    const { error } = await supabase
      .from("projects")
      .update({
        engagement_stage: "settled",
        settlement_note: note,
        settlement_reviewed_by: user.id,
        settlement_reviewed_at: now,
        // 이 확인이 곧 종료 행위다 — 목록·통계가 종료로 보여야 한다
        status: "completed",
        closed_at: now,
      })
      .eq("id", input.projectId);
    if (error) return { ok: false, error: "처리에 실패했습니다." };
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true };
  }

  const rule = await matchApprovalRule("payment", settlement.totalGross);
  const line =
    rule ?? (await buildGradeEscalationLine(user.id, settlement.totalGross));
  if (!line || line.steps.length === 0) {
    return {
      ok: false,
      error:
        "결재선을 정할 수 없습니다. 상위 결재자가 없거나 전결규정(지급 품의)이 등록되지 않았습니다.",
    };
  }

  const created = await createApprovalWithSteps({
    tenantId,
    requesterUserId: user.id,
    title: `[프로젝트 종료 및 지급 품의] ${settlement.projectName} — 전문가 ${settlement.expertCount}명`,
    body: document,
    approvalType: "payment",
    amount: settlement.totalGross,
    projectId: input.projectId,
    appliedRuleId: "ruleId" in line ? line.ruleId : null,
    steps: line.steps,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const { error } = await supabase
    .from("projects")
    .update({
      engagement_stage: "settled",
      settlement_approval_id: created.approvalId,
      settlement_note: note,
      settlement_reviewed_by: user.id,
      settlement_reviewed_at: now,
      status: "completed",
      closed_at: now,
    })
    .eq("id", input.projectId);
  if (error) return { ok: false, error: "품의는 올라갔으나 상태 반영에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "project.settlement_submit",
    resource_type: "project",
    resource_id: input.projectId,
    after_data: {
      approval_id: created.approvalId,
      total_gross: settlement.totalGross,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true };
}
