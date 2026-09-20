import { fmtHours, sessionCount, type DeliveryMode, type SessionSchedule } from "./schedule";

/**
 * 시간당 비용 → 회당 단가 (기획 지시 2026-09-21): 회당 단가 = 시간당 비용 × 회차당 시간.
 * 회차당 시간이 없으면 1시간으로 본다(화면이 그 사실을 알린다).
 */
export function unitFromHourly(hourly: number | null, hoursPerSession: number | null): number | null {
  if (hourly === null) return null;
  return Math.round(hourly * (hoursPerSession ?? 1));
}

/** 문자·품의서에 싣는 진행 방식 표기 */
export const DELIVERY_TERMS_LABELS: Record<DeliveryMode, string> = {
  online: "온라인 멘토링",
  offline: "오프라인 멘토링",
  hybrid: "온라인/오프라인 병행",
};

/**
 * 섭외 조건 한 줄 — "온라인/오프라인 병행 · 총 5회 · 회차당 2시간 · 회차당 단가 온라인 200,000원/오프라인 300,000원".
 * 섭외 문자·메일·후보 화면이 같은 문장을 쓴다. 아무 정보도 없으면 null.
 */
export function engagementTermsText(
  s: SessionSchedule,
  unitOnline: number | null,
  unitOffline: number | null
): string | null {
  const parts: string[] = [];
  if (s.deliveryMode) parts.push(DELIVERY_TERMS_LABELS[s.deliveryMode]);
  const count = sessionCount(s);
  if (count) parts.push(count.min === count.max ? `총 ${count.min}회` : `총 ${count.min}~${count.max}회`);
  if (s.hoursPerSession) parts.push(`회차당 ${fmtHours(s.hoursPerSession)}시간`);
  const mode = s.deliveryMode ?? (unitOffline !== null ? "offline" : unitOnline !== null ? "online" : null);
  if (mode === "hybrid") {
    if (unitOnline !== null || unitOffline !== null) {
      parts.push(
        `회차당 단가 온라인 ${unitOnline !== null ? formatWon(unitOnline) : "미정"}/오프라인 ${
          unitOffline !== null ? formatWon(unitOffline) : "미정"
        }`
      );
    }
  } else if (mode === "online" && unitOnline !== null) {
    parts.push(`회차당 단가 ${formatWon(unitOnline)}`);
  } else if (mode === "offline" && unitOffline !== null) {
    parts.push(`회차당 단가 ${formatWon(unitOffline)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "300,000원" 또는 "300,000원 ~ 500,000원" */
export function formatWonRange(min: number, max: number | null | undefined): string {
  return max !== null && max !== undefined && max !== min ? `${formatWon(min)} ~ ${formatWon(max)}` : formatWon(min);
}

/**
 * 회당 단가 → 총액 (기획 지시 2026-09-21).
 *
 *  - 온라인/오프라인 단일: 총액 = 회당 단가 × 회차. 회차가 범위면 총액도 범위.
 *  - 병행 + 온·오프 회차 입력: 총액 = 온라인단가×온라인회차 + 오프라인단가×오프라인회차 (확정).
 *  - 병행 + 회차 미분리: "전부 온라인으로 했을 때 ~ 전부 오프라인으로 했을 때" 범위.
 * 화면·서버·결재 본문이 같은 식을 쓴다 (순수 함수).
 */

export type FeeTotal = {
  min: number;
  max: number;
  /** 병행 미분리 범위처럼 "왜 범위인가"를 설명하는 짧은 문구 */
  note: string | null;
};

export function computeFeeTotal(
  s: SessionSchedule,
  unitOnline: number | null,
  unitOffline: number | null
): FeeTotal | null {
  const count = sessionCount(s);
  if (!count) return null;
  const mode = s.deliveryMode ?? (unitOffline !== null ? "offline" : unitOnline !== null ? "online" : null);
  if (mode === "online") {
    if (unitOnline === null) return null;
    return { min: unitOnline * count.min, max: unitOnline * count.max, note: null };
  }
  if (mode === "offline") {
    if (unitOffline === null) return null;
    return { min: unitOffline * count.min, max: unitOffline * count.max, note: null };
  }
  if (mode === "hybrid") {
    if (unitOnline === null || unitOffline === null) return null;
    if (s.onlineCount !== null && s.offlineCount !== null) {
      const total = unitOnline * s.onlineCount + unitOffline * s.offlineCount;
      return { min: total, max: total, note: null };
    }
    const allOnline = unitOnline * count.min;
    const allOffline = unitOffline * count.max;
    return {
      min: Math.min(allOnline, allOffline),
      max: Math.max(allOnline, allOffline),
      note: "온·오프라인 회차를 나누지 않아 전부 온라인 ~ 전부 오프라인 범위",
    };
  }
  return null;
}

export function formatWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export function formatFeeTotal(t: FeeTotal | null): string {
  if (!t) return "";
  return t.min === t.max ? formatWon(t.min) : `${formatWon(t.min)} ~ ${formatWon(t.max)}`;
}
