import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getRrnLockdown } from "@/lib/integrations/rrn-lockdown";
import { RRN_PROJECT_LIMIT } from "@/lib/integrations/rrn-access";

/**
 * 기업 보안책임자용 요약 (CLAUDE.md §5)
 *
 * 감시자는 '언제·누가·왜 조회했는지'와 '지금 잠겨 있는지'만 본다. 번호·암호문·
 * 래핑키에는 접근하지 않는다 — 이 모듈은 그런 값을 읽지도 반환하지도 않는다.
 *
 * tax_lockdown·tax_rate_limits는 deny-all(정책 없음)이므로 admin 클라이언트로
 * 읽되, **자사 범위로 좁혀** 요약만 만든다. 어느 테넌트가 잠금을 유발했는지는
 * 자사가 유발한 경우에만 알려준다.
 */

export type SecuritySummary = {
  /** 전체(플랫폼) 잠금 — 해제는 캐스트로그 관리모드에서만 */
  lockdown: { locked: boolean; reason?: string; triggeredAt?: string; byUs: boolean };
  /** 자사 조회 지정자 중 시간당 상한으로 자동 잠긴 사람 수 */
  rateLockedDesignees: number;
  /** 조회 키(테넌트 키페어) 설정 여부 — 미설정이면 조회 자체가 불가 */
  keyConfigured: boolean;
  /** 자사에서 발생한 총 조회 건수 / 최근 30일 */
  totalAccessCount: number;
  recentAccessCount: number;
  /** 한도를 넘긴 조회 건수 */
  overLimitAccessCount: number;
  /** 대표 승인 대기 중인 초과 조회 요청 수 */
  pendingRequestCount: number;
};

export type QuotaRow = {
  projectId: string | null;
  projectName: string;
  expertId: string;
  expertName: string;
  used: number;
  limit: number;
};

/** 자사 보안 요약. 감시 권한 확인은 호출측(화면 게이트)에서 끝낸 뒤 호출한다. */
export async function getSecuritySummary(
  tenantId: string
): Promise<SecuritySummary> {
  const empty: SecuritySummary = {
    lockdown: { locked: false, byUs: false },
    rateLockedDesignees: 0,
    keyConfigured: false,
    totalAccessCount: 0,
    recentAccessCount: 0,
    overLimitAccessCount: 0,
    pendingRequestCount: 0,
  };
  if (!hasSupabaseEnv()) return empty;

  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [
    lock,
    { count: keyCount },
    { count: total },
    { count: recent },
    { count: overLimit },
    { count: pending },
    { data: designees },
  ] = await Promise.all([
    getRrnLockdown(),
    admin
      .from("tenant_rrn_keys")
      .select("tenant_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    admin
      .from("tax_access_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    admin
      .from("tax_access_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("accessed_at", since),
    admin
      .from("tax_access_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_over_limit", true),
    admin
      .from("tax_access_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    admin
      .from("tax_access_grants")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .is("revoked_at", null),
  ]);

  // 시간당 상한 자동 잠금은 사용자 단위다. 자사 지정자만 추려서 센다.
  let rateLocked = 0;
  const designeeIds = (designees ?? []).map((g) => g.user_id);
  if (designeeIds.length > 0) {
    const { data: limits } = await admin
      .from("tax_rate_limits")
      .select("subject_id, locked_until")
      .eq("subject_type", "user")
      .in("subject_id", designeeIds)
      .not("locked_until", "is", null);
    const now = Date.now();
    const locked = new Set(
      (limits ?? [])
        .filter((l) => l.locked_until && new Date(l.locked_until).getTime() > now)
        .map((l) => l.subject_id)
    );
    rateLocked = locked.size;
  }

  // 잠금을 유발한 주체가 자사인지 — 타사 정보는 노출하지 않는다.
  let byUs = false;
  if (lock.locked) {
    const { count } = await admin
      .from("tax_lockdown")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("triggered_tenant", tenantId);
    byUs = (count ?? 0) > 0;
  }

  return {
    lockdown: { ...lock, byUs },
    rateLockedDesignees: rateLocked,
    keyConfigured: (keyCount ?? 0) > 0,
    totalAccessCount: total ?? 0,
    recentAccessCount: recent ?? 0,
    overLimitAccessCount: overLimit ?? 0,
    pendingRequestCount: pending ?? 0,
  };
}

/**
 * 프로젝트·전문가별 한도 사용 현황. 한도(2회)에 도달했거나 넘긴 조합을 위로 올린다.
 * 이력 자체가 유일한 사실 원천이므로 로그를 접어서 만든다.
 */
export function foldQuotaRows(
  logs: {
    project_id: string | null;
    project_name: string | null;
    expert_id: string;
  }[],
  expertNameById: Map<string, string>
): QuotaRow[] {
  const byKey = new Map<string, QuotaRow>();
  for (const log of logs) {
    const key = `${log.project_id ?? "-"}::${log.expert_id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.used += 1;
      continue;
    }
    byKey.set(key, {
      projectId: log.project_id,
      projectName: log.project_name ?? (log.project_id ? "(프로젝트)" : "프로젝트 미연결"),
      expertId: log.expert_id,
      expertName: expertNameById.get(log.expert_id) ?? "전문가",
      used: 1,
      limit: RRN_PROJECT_LIMIT,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => b.used - a.used);
}
