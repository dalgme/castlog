/**
 * 실시간 사용자 테스트 모니터링 창 — feature_flags 파서 (기획 2026-08-29)
 *
 * 관리모드가 기업별로 tenants.feature_flags.monitor_until(ISO 시각)을 켠다.
 * "지금이 그 시각 전"이면 모니터링 창이 열린 것이다. 스위치+시각을 하나로
 * 합친 이유: 켜 두고 잊어도 창이 스스로 닫힌다 — 테스트 계측이 상시 수집으로
 * 눌러앉지 않게 하는 안전장치다.
 *
 * parseModuleFlags와 같은 방어적 파서 — 형식 오류·부재는 조용히 "꺼짐"으로
 * 흡수한다(§14-10 부재 폴백: 이 키를 모르는 과거 데이터가 그대로 동작해야 한다).
 * 클라이언트에서도 임포트될 수 있어 server-only를 붙이지 않는다.
 */

import type { Json } from "@/lib/supabase/database.types";

/** feature_flags에서 모니터링 종료 시각을 읽는다. 없거나 깨졌으면 null */
export function parseMonitorUntil(
  featureFlags: Json | null | undefined
): string | null {
  if (
    featureFlags === null ||
    featureFlags === undefined ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return null;
  }
  const raw = (featureFlags as Record<string, Json | undefined>).monitor_until;
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return raw;
}

/** 모니터링 창이 지금 열려 있는가 */
export function isMonitorActive(
  featureFlags: Json | null | undefined,
  now: Date = new Date()
): boolean {
  const until = parseMonitorUntil(featureFlags);
  if (!until) return false;
  return Date.parse(until) > now.getTime();
}
