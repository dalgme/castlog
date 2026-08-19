import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ModuleFlags } from "@/lib/modules/modules";

/**
 * 테넌트 대시보드 집계 (사업연도 축 — CLAUDE.md §12-7).
 *
 * **권한은 RLS에 맡긴다.** 대표·이사는 전사 프로젝트가 보이고(app.can_view_all_projects),
 * 팀장 이하는 배정된 프로젝트만 보인다. 같은 집계 함수가 보는 사람에 따라 저절로
 * 범위를 좁히므로, 여기서 등급별 분기를 따로 두지 않는다 — 두 벌로 만들면
 * 한쪽만 고쳐지는 사고가 난다.
 */

export type ProjectProgressRow = {
  id: string;
  name: string;
  status: string;
  /** 21스텝 진행률 0~100. 스텝이 없으면 null */
  progress: number | null;
  budget: number;
  /** 이 프로젝트에서 확정(수락)된 섭외비 합 */
  confirmedCost: number;
  /** 요청 중이라 아직 확정되지 않은 섭외비 합 */
  requestedCost: number;
};

export type TenantDashboard = {
  year: number;
  projects: {
    total: number;
    byStatus: Record<string, number>;
    /** 진행률 상위 표시용 (진행중 우선, 진행률 낮은 순) */
    rows: ProjectProgressRow[];
  };
  /** 카테고리별 프로젝트 수 (미지정 포함) */
  categories: { name: string; count: number }[];
  cost: {
    budgetTotal: number;
    plannedCost: number;
    requestedCost: number;
    confirmedCost: number;
    /** 지급 확정·완료된 배치 기준 */
    paidGross: number;
    paidNet: number;
    paidBatches: number;
  };
  experts: {
    linked: number;
    engagements: { requested: number; accepted: number; declined: number; canceled: number };
  } | null;
  approvals: {
    inProgress: number;
    approvedThisYear: number;
    rejectedThisYear: number;
  } | null;
};

export async function getTenantDashboard(
  year: number,
  modules: ModuleFlags
): Promise<TenantDashboard> {
  const supabase = createClient();
  const yearStart = `${year}-01-01T00:00:00Z`;
  const yearEnd = `${year + 1}-01-01T00:00:00Z`;

  const { data: projectRows } = await supabase
    .from("projects")
    .select(
      "id, name, status, budget_amount, category_id, project_lifecycle_steps (status)"
    )
    .eq("business_year", year)
    .order("created_at", { ascending: false });

  const projects = projectRows ?? [];
  const projectIds = projects.map((p) => p.id);

  const [
    categoryResult,
    slotResult,
    engagementResult,
    linkResult,
    approvalResult,
    batchResult,
  ] = await Promise.all([
    supabase.from("project_categories").select("id, name"),
    // 계획 섭외비 = 세션별 1인당 비용 × 필요인원
    projectIds.length
      ? supabase
          .from("engagement_slots")
          .select("project_id, fee_amount, required_count")
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    modules.experts && projectIds.length
      ? supabase
          .from("expert_engagements")
          .select("project_id, status, fee_amount")
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    modules.experts
      ? supabase
          .from("expert_tenant_links")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
      : Promise.resolve({ count: null }),
    modules.approvals
      ? supabase
          .from("approvals")
          .select("status, completed_at")
      : Promise.resolve({ data: null }),
    modules.experts
      ? supabase
          .from("expert_payment_batches")
          .select("total_gross, total_net, status")
          .in("status", ["confirmed", "paid"])
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd)
      : Promise.resolve({ data: null }),
  ]);

  // ---- 프로젝트 진행 현황 -----------------------------------------------------
  const byStatus: Record<string, number> = {};
  const costByProject = new Map<
    string,
    { confirmed: number; requested: number }
  >();
  for (const e of engagementResult.data ?? []) {
    if (!e.project_id) continue;
    const entry = costByProject.get(e.project_id) ?? {
      confirmed: 0,
      requested: 0,
    };
    if (e.status === "accepted") entry.confirmed += e.fee_amount ?? 0;
    else if (e.status === "requested") entry.requested += e.fee_amount ?? 0;
    costByProject.set(e.project_id, entry);
  }

  const rows: ProjectProgressRow[] = projects.map((p) => {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const steps = p.project_lifecycle_steps ?? [];
    const done = steps.filter(
      (s) => s.status === "completed" || s.status === "skipped"
    ).length;
    const cost = costByProject.get(p.id) ?? { confirmed: 0, requested: 0 };
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      progress: steps.length ? Math.round((done / steps.length) * 100) : null,
      budget: p.budget_amount ?? 0,
      confirmedCost: cost.confirmed,
      requestedCost: cost.requested,
    };
  });

  // 진행중 → 계획 → 그 외 순, 같은 그룹에서는 진행률이 낮은(손이 더 필요한) 순
  const statusWeight: Record<string, number> = {
    active: 0,
    planned: 1,
    on_hold: 2,
    completed: 3,
    cancelled: 4,
  };
  rows.sort(
    (a, b) =>
      (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) ||
      (a.progress ?? 0) - (b.progress ?? 0)
  );

  // ---- 카테고리 구성 ----------------------------------------------------------
  const categoryNameById = new Map(
    (categoryResult.data ?? []).map((c) => [c.id, c.name])
  );
  const categoryCount = new Map<string, number>();
  for (const p of projects) {
    const name = p.category_id
      ? (categoryNameById.get(p.category_id) ?? "(삭제된 분야)")
      : "미지정";
    categoryCount.set(name, (categoryCount.get(name) ?? 0) + 1);
  }
  const categories = Array.from(categoryCount, ([name, count]) => ({
    name,
    count,
  })).sort((a, b) => b.count - a.count);

  // ---- 비용 -------------------------------------------------------------------
  const plannedCost = (slotResult.data ?? []).reduce(
    (sum, s) => sum + (s.fee_amount ?? 0) * s.required_count,
    0
  );
  const paidRows = batchResult.data ?? [];
  const cost = {
    budgetTotal: rows.reduce((sum, r) => sum + r.budget, 0),
    plannedCost,
    requestedCost: rows.reduce((sum, r) => sum + r.requestedCost, 0),
    confirmedCost: rows.reduce((sum, r) => sum + r.confirmedCost, 0),
    paidGross: paidRows.reduce((sum, b) => sum + b.total_gross, 0),
    paidNet: paidRows.reduce((sum, b) => sum + b.total_net, 0),
    paidBatches: paidRows.length,
  };

  // ---- 섭외 -------------------------------------------------------------------
  let experts: TenantDashboard["experts"] = null;
  if (modules.experts) {
    const engagements = {
      requested: 0,
      accepted: 0,
      declined: 0,
      canceled: 0,
    };
    for (const e of engagementResult.data ?? []) {
      if (e.status === "requested") engagements.requested += 1;
      else if (e.status === "accepted") engagements.accepted += 1;
      else if (e.status === "declined") engagements.declined += 1;
      else if (e.status === "canceled") engagements.canceled += 1;
    }
    experts = {
      linked: ("count" in linkResult ? linkResult.count : null) ?? 0,
      engagements,
    };
  }

  // ---- 결재 -------------------------------------------------------------------
  let approvals: TenantDashboard["approvals"] = null;
  if (modules.approvals) {
    const all = approvalResult.data ?? [];
    const inYear = (completedAt: string | null) =>
      completedAt !== null && completedAt >= yearStart && completedAt < yearEnd;
    approvals = {
      inProgress: all.filter((a) => a.status === "in_progress").length,
      approvedThisYear: all.filter(
        (a) => a.status === "approved" && inYear(a.completed_at)
      ).length,
      rejectedThisYear: all.filter(
        (a) => a.status === "rejected" && inYear(a.completed_at)
      ).length,
    };
  }

  return {
    year,
    projects: { total: projects.length, byStatus, rows },
    categories,
    cost,
    experts,
    approvals,
  };
}
