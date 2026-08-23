"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { PLAN_STATUS_LABELS } from "@/lib/integrations/engagement-plans";

/**
 * 세션계획 버전 이력 (기획 확정 2026-08-23).
 * 상신 1건 = 버전 1개(engagement_plans.revision). 각 버전에는 상신 당시의
 * 세션·후보 라인 스냅샷(engagement_plan_lines)과 결재자 수정 내역
 * (plan_review_changes), 반려 사유가 함께 남는다 — 최초 계획부터 현재까지
 * 무엇이 어떻게 바뀌었는지 버전 단위로 추적한다.
 */

export type PlanVersionLine = {
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleDescription: string | null;
  requiredCount: number;
  feeAmount: number;
  locationName: string | null;
};

export type PlanVersionChange = {
  kind: string;
  positionCode: string | null;
  expertName: string | null;
  beforeText: string | null;
  afterText: string | null;
  createdAt: string;
};

export type PlanVersion = {
  id: string;
  revision: number;
  statusLabel: string;
  plannedAmount: number;
  slotCount: number;
  positionCount: number;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  note: string | null;
  lines: PlanVersionLine[];
  reviewChanges: PlanVersionChange[];
};

export async function getEngagementPlanVersions(
  projectId: string
): Promise<{ ok: true; versions: PlanVersion[] } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !tenantIdFromUser(user)) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  // RLS가 배정 범위를 지킨다 — 보이는 프로젝트의 계획만 조회된다
  const { data: plans, error } = await supabase
    .from("engagement_plans")
    .select(
      "id, revision, status, approval_id, planned_amount, slot_count, position_count, submitted_at, approved_at, last_rejection_note, note"
    )
    .eq("project_id", projectId)
    .order("revision", { ascending: false });
  if (error) return { ok: false, error: "버전 이력을 불러오지 못했습니다." };
  if (!plans || plans.length === 0) {
    return { ok: true, versions: [] };
  }

  const planIds = plans.map((p) => p.id);
  const approvalIds = plans.map((p) => p.approval_id).filter(Boolean) as string[];

  const [{ data: lines }, changesResult] = await Promise.all([
    supabase
      .from("engagement_plan_lines")
      .select(
        "plan_id, slot_date, starts_time, ends_time, role_description, required_count, fee_amount, location_name"
      )
      .in("plan_id", planIds)
      .order("slot_date", { ascending: true }),
    approvalIds.length
      ? supabase
          .from("plan_review_changes")
          .select(
            "approval_id, change_kind, position_code, expert_name, before_text, after_text, created_at"
          )
          .in("approval_id", approvalIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);

  const linesByPlan = new Map<string, PlanVersionLine[]>();
  for (const l of lines ?? []) {
    const list = linesByPlan.get(l.plan_id) ?? [];
    list.push({
      slotDate: l.slot_date,
      startsTime: l.starts_time,
      endsTime: l.ends_time,
      roleDescription: l.role_description,
      requiredCount: l.required_count,
      feeAmount: l.fee_amount,
      locationName: l.location_name,
    });
    linesByPlan.set(l.plan_id, list);
  }
  const changesByApproval = new Map<string, PlanVersionChange[]>();
  for (const c of changesResult.data ?? []) {
    const list = changesByApproval.get(c.approval_id) ?? [];
    list.push({
      kind: c.change_kind,
      positionCode: c.position_code,
      expertName: c.expert_name,
      beforeText: c.before_text,
      afterText: c.after_text,
      createdAt: c.created_at,
    });
    changesByApproval.set(c.approval_id, list);
  }

  return {
    ok: true,
    versions: plans.map((p) => ({
      id: p.id,
      revision: p.revision,
      statusLabel:
        p.status === "draft" && p.last_rejection_note
          ? "반려"
          : (PLAN_STATUS_LABELS[
              p.status as keyof typeof PLAN_STATUS_LABELS
            ] ?? p.status),
      plannedAmount: p.planned_amount,
      slotCount: p.slot_count,
      positionCount: p.position_count,
      submittedAt: p.submitted_at,
      approvedAt: p.approved_at,
      rejectionNote: p.last_rejection_note,
      note: p.note,
      lines: linesByPlan.get(p.id) ?? [],
      reviewChanges: p.approval_id
        ? (changesByApproval.get(p.approval_id) ?? [])
        : [],
    })),
  };
}
