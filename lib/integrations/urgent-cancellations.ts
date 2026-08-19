import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 긴급 취소 알림 — 확정된 전문가가 갑자기 못 오게 된 건.
 *
 * 이건 '나중에 확인할 소식'이 아니라 **지금 대체 인력을 찾아야 하는 사건**이다.
 * 그래서 담당자 화면에만 두지 않고 대시보드·섭외 화면 맨 위에 흐르게 띄운다.
 * 확정 이후 취소(is_urgent)만 대상이다 — 요청 중 취소는 급하지 않다.
 */

/** 며칠 지난 건까지 띄울 것인가. 지난 일을 계속 흘리면 아무도 안 본다 */
export const URGENT_NOTICE_DAYS = 7;

export type UrgentCancellation = {
  id: string;
  expertName: string;
  projectId: string | null;
  projectName: string | null;
  reason: string | null;
  canceledAt: string;
};

export async function getUrgentCancellations(options?: {
  /** 특정 프로젝트만 (프로젝트 화면용). 없으면 전사 */
  projectId?: string;
  limit?: number;
}): Promise<UrgentCancellation[]> {
  if (!hasSupabaseEnv()) return [];

  const since = new Date(
    Date.now() - URGENT_NOTICE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const supabase = createClient();
  let query = supabase
    .from("engagement_cancellations")
    .select(
      "id, reason, canceled_at, project_id, experts (name), projects (name)"
    )
    .eq("is_urgent", true)
    .gte("canceled_at", since)
    .order("canceled_at", { ascending: false })
    .limit(options?.limit ?? 10);

  if (options?.projectId) query = query.eq("project_id", options.projectId);

  const { data } = await query;

  return (data ?? []).map((row) => ({
    id: row.id,
    expertName: row.experts?.name ?? "전문가",
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
    reason: row.reason,
    canceledAt: row.canceled_at,
  }));
}

/**
 * 긴급 취소로 다시 비게 된 코드넘버 → 취소한 전문가 이름.
 *
 * 취소하면 코드넘버 자리는 미섭외로 되돌아가고 expert_id·engagement_id가
 * 지워진다(그래야 다른 전문가를 붙일 수 있다). 그래서 자리 자체에는 "누가
 * 취소했는지"가 남지 않는다. 섭외 건이 들고 있던 position_code로 되짚는다.
 */
export async function getCanceledExpertByPositionCode(
  projectId: string
): Promise<Record<string, string>> {
  if (!hasSupabaseEnv()) return {};

  const supabase = createClient();
  const { data } = await supabase
    .from("engagement_cancellations")
    .select("expert_id, experts (name), expert_engagements (position_code)")
    .eq("project_id", projectId)
    .eq("is_urgent", true)
    .order("canceled_at", { ascending: false });

  const byCode: Record<string, string> = {};
  for (const row of data ?? []) {
    const code = row.expert_engagements?.position_code;
    if (!code || byCode[code]) continue; // 가장 최근 취소만
    byCode[code] = row.experts?.name ?? "전문가";
  }
  return byCode;
}
