import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";

export type BusyItem = {
  source: "external" | "own_engagement";
  /** 표시 라벨(외부 일정은 상세 미노출, 자사 섭외는 역할 표시) */
  label: string;
  start: string;
  end: string | null;
  allDay: boolean;
};

export type AvailabilityResult =
  | { ok: true; items: BusyItem[] }
  | { ok: false; error: string };

/**
 * 섭외 전 가용성 확인 — 연결 기업이 전문가의 '바쁜 날'을 미리 참고한다.
 *
 * 테넌트 격리(§4): 다른 테넌트의 캐스트로그 섭외 일정은 절대 노출하지 않는다.
 *  - 노출 대상: (1) 전문가가 공유 허용한 외부 일정(상세 미노출), (2) 자사 섭외 일정.
 *  - 활성 연결이 있는 전문가에 한해 조회 가능.
 */
export async function getExpertAvailability(
  expertId: string,
  fromISO: string,
  toISO: string
): Promise<AvailabilityResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return { ok: false, error: "권한이 없습니다." };

  // 활성 연결 확인(RLS + 명시)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 확인할 수 있습니다." };
  }

  const admin = createAdminClient();
  const items: BusyItem[] = [];

  // (1) 전문가가 공유 허용한 외부 일정 — 상세는 감추고 '외부 일정'으로만
  const { data: externals } = await admin
    .from("expert_external_schedules")
    .select("starts_at, ends_at, all_day")
    .eq("expert_id", expertId)
    .eq("shared_with_tenants", true)
    .gte("starts_at", fromISO)
    .lte("starts_at", toISO)
    .order("starts_at", { ascending: true });
  for (const e of externals ?? []) {
    items.push({
      source: "external",
      label: "외부 일정",
      start: e.starts_at,
      end: e.ends_at,
      allDay: e.all_day,
    });
  }

  // (2) 자사(현재 테넌트) 섭외 일정만 — 다른 테넌트 건은 절대 포함하지 않음
  const { data: engagements } = await admin
    .from("expert_engagements")
    .select("role_description, starts_on, ends_on, status")
    .eq("expert_id", expertId)
    .eq("tenant_id", tenantId)
    .in("status", ["requested", "accepted"])
    .not("starts_on", "is", null)
    .gte("starts_on", fromISO.slice(0, 10))
    .lte("starts_on", toISO.slice(0, 10))
    .order("starts_on", { ascending: true });
  for (const g of engagements ?? []) {
    if (!g.starts_on) continue;
    items.push({
      source: "own_engagement",
      label:
        (g.status === "accepted" ? "자사 섭외(확정)" : "자사 섭외(요청중)") +
        (g.role_description ? ` · ${g.role_description}` : ""),
      start: g.starts_on,
      end: g.ends_on,
      allDay: true,
    });
  }

  items.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return { ok: true, items };
}
