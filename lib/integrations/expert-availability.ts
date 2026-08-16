import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";

/** 자사 섭외(상세 공개) — 요청 테넌트 본인의 섭외 건만. */
export type OwnConflict = {
  roleDescription: string | null;
  startsOn: string;
  endsOn: string | null;
  status: string;
};

export type ScreenResult =
  | {
      ok: true;
      /** 입력 기간과 겹치는 일정이 하나라도 있는지 */
      hasConflict: boolean;
      /** 자사 섭외 겹침(상세 공개) */
      ownConflicts: OwnConflict[];
      /**
       * 상세를 공개하지 않는 겹침 건수 —
       * (1) 다른 회사의 섭외, (2) 전문가가 직접 등록한 일정.
       * 겹침 여부/건수만 반환하고 기관·제목 등 상세는 절대 포함하지 않는다.
       */
      blindConflictCount: number;
    }
  | { ok: false; error: string };

function overlaps(
  from: number,
  to: number,
  startISO: string,
  endISO: string | null
): boolean {
  const s = new Date(startISO).getTime();
  const e = endISO ? new Date(endISO).getTime() : s;
  // 종일/날짜 값은 해당 날짜의 끝까지 겹침으로 본다.
  const eAdj = e + (endISO ? 0 : 0);
  return s <= to && eAdj >= from;
}

/**
 * 섭외 전 일정 스크리닝 — 특정 일시 범위에 대해 '겹치는지'만 1차 판독한다.
 *
 * 노출 규칙(§4 테넌트 격리 엄수):
 *  - 자사(요청 테넌트) 섭외와 겹치면 → 그 내역을 보여준다.
 *  - 다른 회사의 섭외, 전문가가 직접 등록한 일정과 겹치면 →
 *    상세는 절대 보여주지 않고 '겹침 여부/건수'만 판독한다.
 */
export async function screenExpertSchedule(
  expertId: string,
  fromISO: string,
  toISO: string
): Promise<ScreenResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return { ok: false, error: "권한이 없습니다." };

  // 활성 연결 확인
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 확인할 수 있습니다." };
  }

  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (!(from <= to)) return { ok: false, error: "확인할 기간을 올바르게 입력하세요." };

  const admin = createAdminClient();

  // 전문가의 모든 캐스트로그 섭외(전 테넌트) — 겹침 판독용. 상세는 자사 건만 사용.
  const { data: engagements } = await admin
    .from("expert_engagements")
    .select("tenant_id, role_description, starts_on, ends_on, status")
    .eq("expert_id", expertId)
    .in("status", ["requested", "accepted"])
    .not("starts_on", "is", null);

  // 전문가가 직접 등록한 일정 — 공유 허용분만 겹침 판독에 포함(상세 미노출).
  const { data: externals } = await admin
    .from("expert_external_schedules")
    .select("starts_at, ends_at")
    .eq("expert_id", expertId)
    .eq("shared_with_tenants", true);

  const ownConflicts: OwnConflict[] = [];
  let blindConflictCount = 0;

  for (const g of engagements ?? []) {
    if (!g.starts_on) continue;
    if (!overlaps(from, to, g.starts_on, g.ends_on)) continue;
    if (g.tenant_id === tenantId) {
      ownConflicts.push({
        roleDescription: g.role_description,
        startsOn: g.starts_on,
        endsOn: g.ends_on,
        status: g.status,
      });
    } else {
      // 다른 회사의 섭외 — 상세 없이 겹침만
      blindConflictCount++;
    }
  }

  for (const e of externals ?? []) {
    if (overlaps(from, to, e.starts_at, e.ends_at)) blindConflictCount++;
  }

  return {
    ok: true,
    hasConflict: ownConflicts.length > 0 || blindConflictCount > 0,
    ownConflicts,
    blindConflictCount,
  };
}
