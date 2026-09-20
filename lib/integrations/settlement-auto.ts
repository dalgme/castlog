import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { getTenantModules } from "@/lib/modules/server";
import { projectStage, type ProjectStage } from "@/lib/integrations/project-stage";
import { getProjectSettlement } from "@/lib/integrations/project-settlement";

/**
 * 지급 품의서 자동 생성 (기획 지시 2026-09-21).
 *
 * 섭외 확정 탭에서 **모든 전문가의 평가·종료**가 끝나고, 참여율 배분이 **100%로 확정**되면
 * 담당자가 '마감 시작'·'지급 품의 검토 요청'을 누르지 않아도 프로젝트가 '지급 품의 검토'
 * 단계로 넘어가 지급 품의서가 만들어진다. 회계담당자 확인 → 결재 상신은 종전대로 사람이
 * 한다 (§14-3 — 결재 상신은 2단계 확인이 있는 위험 작업이라 자동으로 쏘지 않는다).
 *
 * 평가·종료·참여율 확정 액션이 끝날 때마다 부른다. 조건이 안 되면 아무 일도 하지 않는다.
 * 단계 전환은 시스템 행위라 admin 클라이언트로 쓰되, 판정 데이터는 RLS 클라이언트로 읽고
 * 테넌트를 다시 대조한다.
 */

/** 자동 전환을 검토할 단계 — 계약 성립 뒤, 지급 품의 검토 전 */
const ELIGIBLE: ProjectStage[] = ["accepted_all", "letters_sent", "confirmed", "closing"];

export type AutoSettlementStatus = {
  /** 계약 성립(accepted) 건 수 */
  acceptedCount: number;
  /** 종료(completed_at) 처리된 건 수 */
  completedCount: number;
  /** 평가(만족도) 미입력 건 수 */
  unratedCount: number;
  contributionTotal: number;
  contributionConfirmed: boolean;
  stage: ProjectStage;
};

/** 화면(마감 탭)이 자동 조건의 현재 상태를 보여 주기 위한 판정 — 전환은 하지 않는다 */
export async function getAutoSettlementStatus(
  projectId: string
): Promise<AutoSettlementStatus | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();
  const settlement = await getProjectSettlement(projectId);
  if (!settlement) return null;

  const engagementsResult = await supabase
    .from("expert_engagements")
    .select("id, completed_at")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  // 종료 컬럼(0005) 미적용 환경 — 종료 0건으로 본다 (§14-10)
  const engagements = isMissingColumnError(engagementsResult.error)
    ? []
    : (engagementsResult.data ?? []);

  const confirmResult = await supabase
    .from("projects")
    .select("contribution_confirmed_at")
    .eq("id", projectId)
    .maybeSingle();
  const contributionConfirmed = Boolean(confirmResult.data?.contribution_confirmed_at);

  return {
    acceptedCount: engagements.length,
    completedCount: engagements.filter((e) => e.completed_at !== null).length,
    unratedCount: settlement.unratedCount,
    contributionTotal: settlement.contributionTotal,
    contributionConfirmed,
    stage: settlement.stage,
  };
}

export function autoSettlementReady(s: AutoSettlementStatus): boolean {
  return (
    s.acceptedCount > 0 &&
    s.completedCount === s.acceptedCount &&
    s.unratedCount === 0 &&
    s.contributionTotal === 100 &&
    s.contributionConfirmed
  );
}

/**
 * 조건이 다 갖춰졌으면 '지급 품의 검토' 단계로 올리고 회계담당자에게 알린다.
 * 반환값: 전환했으면 true. 실패는 던지지 않는다 — 호출한 액션(평가·종료·확정)의
 * 성공을 되돌릴 이유가 없고, 담당자는 마감 탭의 '지급 품의 검토 요청'으로 손수 넘길 수 있다.
 */
export async function tryAutoSettlementReview(input: {
  projectId: string;
  tenantId: string;
  actorUserId: string;
  actorRole: string;
}): Promise<boolean> {
  try {
    if (!hasSupabaseEnv()) return false;
    const modules = await getTenantModules();
    if (!modules.experts) return false;

    const status = await getAutoSettlementStatus(input.projectId);
    if (!status || !autoSettlementReady(status)) return false;
    if (!ELIGIBLE.includes(status.stage)) return false;

    const admin = createAdminClient();
    const { data: project } = await admin
      .from("projects")
      .select("id, tenant_id, name, engagement_stage, status")
      .eq("id", input.projectId)
      .maybeSingle();
    if (!project || project.tenant_id !== input.tenantId) return false;
    if (project.status === "completed" || project.status === "cancelled") return false;
    // 사이에 누가 이미 넘겼으면 그대로 둔다
    if (!ELIGIBLE.includes(projectStage(project.engagement_stage))) return false;

    const settlement = await getProjectSettlement(input.projectId);
    if (!settlement) return false;

    const { error } = await admin
      .from("projects")
      .update({ engagement_stage: "settlement_review" })
      .eq("id", input.projectId)
      .eq("tenant_id", input.tenantId);
    if (error) return false;

    await admin.from("tenant_alerts").insert({
      tenant_id: input.tenantId,
      severity: "info",
      category: "settlement_review",
      title: `지급 품의서 자동 생성 — ${project.name}`,
      // 금액은 넣지 않는다 — 전사에 보일 수 있는 텍스트다. 숫자는 지급 화면에서 본다
      body: `전문가 ${settlement.expertCount}명의 평가·종료와 참여율 확정이 끝나 지급 품의서가 만들어졌습니다. 회계담당자의 검토가 필요합니다.`,
      resource_type: "project",
      resource_id: input.projectId,
      created_by: input.actorUserId,
    });

    await admin.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_auth_user_id: input.actorUserId,
      actor_role: input.actorRole,
      action: "project.settlement_review_auto",
      resource_type: "project",
      resource_id: input.projectId,
      before_data: { engagement_stage: project.engagement_stage },
      after_data: {
        engagement_stage: "settlement_review",
        expert_count: settlement.expertCount,
        total_gross: settlement.totalGross,
      },
    });
    return true;
  } catch {
    return false;
  }
}
