import { sessionCount, type SessionSchedule } from "./schedule";

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
