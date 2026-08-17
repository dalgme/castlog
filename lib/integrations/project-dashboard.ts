import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 프로젝트별 대시보드 지표 (operations).
 *
 * 담당자가 자기 프로젝트 상태를 한 화면에서 파악하기 위한 요약이다.
 * RLS가 이미 프로젝트 가시성을 좁혀 두므로 여기서 별도 권한 판정을 하지 않는다.
 */

export type ProjectDashboard = {
  /** 넘버링코드(필요인원) 충원 현황 */
  positions: { total: number; filled: number; requested: number; open: number };
  /** 수락서 진행 현황 */
  acceptances: {
    issued: number;
    sent: number;
    signed: number;
    confirmed: number;
  };
  /** 섭외 현황 */
  engagements: { requested: number; accepted: number; declined: number };
  /** 이 프로젝트로 올라간 미결 품의 */
  openApprovals: number;
  /** 21스텝 진행률 */
  steps: { total: number; done: number };
};

export async function getProjectDashboard(
  projectId: string,
  options: { experts: boolean; approvals: boolean }
): Promise<ProjectDashboard> {
  const supabase = createClient();

  const [positionRows, acceptanceRows, engagementRows, approvalRows, stepRows] =
    await Promise.all([
      options.experts
        ? supabase
            .from("engagement_slot_positions")
            .select("status, engagement_slots!inner (project_id)")
            .eq("engagement_slots.project_id", projectId)
        : Promise.resolve({ data: null }),
      options.experts
        ? supabase
            .from("engagement_acceptances")
            .select("status, expert_engagements!inner (project_id)")
            .eq("expert_engagements.project_id", projectId)
        : Promise.resolve({ data: null }),
      options.experts
        ? supabase
            .from("expert_engagements")
            .select("status")
            .eq("project_id", projectId)
        : Promise.resolve({ data: null }),
      options.approvals
        ? supabase
            .from("approvals")
            .select("status")
            .eq("project_id", projectId)
            .eq("status", "in_progress")
        : Promise.resolve({ data: null }),
      supabase
        .from("project_lifecycle_steps")
        .select("status")
        .eq("project_id", projectId),
    ]);

  const positions = { total: 0, filled: 0, requested: 0, open: 0 };
  for (const row of positionRows.data ?? []) {
    if (row.status === "canceled") continue;
    positions.total += 1;
    if (row.status === "filled") positions.filled += 1;
    else if (row.status === "requested") positions.requested += 1;
    else positions.open += 1;
  }

  const acceptances = { issued: 0, sent: 0, signed: 0, confirmed: 0 };
  for (const row of acceptanceRows.data ?? []) {
    if (row.status === "issued") acceptances.issued += 1;
    else if (row.status === "sent") acceptances.sent += 1;
    else if (row.status === "signed") acceptances.signed += 1;
    else if (row.status === "confirmed") acceptances.confirmed += 1;
  }

  const engagements = { requested: 0, accepted: 0, declined: 0 };
  for (const row of engagementRows.data ?? []) {
    if (row.status === "requested") engagements.requested += 1;
    else if (row.status === "accepted") engagements.accepted += 1;
    else if (row.status === "declined") engagements.declined += 1;
  }

  const allSteps = stepRows.data ?? [];
  const steps = {
    total: allSteps.length,
    done: allSteps.filter(
      (s) => s.status === "completed" || s.status === "skipped"
    ).length,
  };

  return {
    positions,
    acceptances,
    engagements,
    openApprovals: (approvalRows.data ?? []).length,
    steps,
  };
}
