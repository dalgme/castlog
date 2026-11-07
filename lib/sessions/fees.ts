import { fmtHours, sessionCount, type DeliveryMode, type SessionSchedule } from "./schedule";

/**
 * 시간당 비용 → 회당 단가 (기획 지시 2026-09-21): 회당 단가 = 시간당 비용 × 회차당 시간.
 * 회차당 시간이 없으면 1시간으로 본다(화면이 그 사실을 알린다).
 */
export function unitFromHourly(hourly: number | null, hoursPerSession: number | null): number | null {
  if (hourly === null) return null;
  return Math.round(hourly * (hoursPerSession ?? 1));
}

/** 문자·품의서에 싣는 진행 방식 표기 (역할 무관 구표기 — deliveryTermsLabel을 쓴다) */
export const DELIVERY_TERMS_LABELS: Record<DeliveryMode, string> = {
  online: "온라인 멘토링",
  offline: "오프라인 멘토링",
  hybrid: "온라인/오프라인 병행",
};

/** 역할별 활동 명사 — 강사 자리에 "오프라인 멘토링"이 나가던 결함 보정 (2026-11-07) */
const ROLE_ACTIVITY: Record<string, string> = {
  lecturer: "강의",
  mentor: "멘토링",
  judge: "심사",
  host: "진행",
  announcer: "진행",
  assistant: "지원",
};

/** "오프라인 강의" · "온라인 멘토링" · "온라인/오프라인 병행" — 역할을 모르면 "오프라인 진행" */
export function deliveryTermsLabel(mode: DeliveryMode, roleType?: string | null): string {
  if (mode === "hybrid") return DELIVERY_TERMS_LABELS.hybrid;
  const activity = (roleType && ROLE_ACTIVITY[roleType]) || "진행";
  return `${mode === "online" ? "온라인" : "오프라인"} ${activity}`;
}

/**
 * 섭외 조건 — 문자·메일·후보 화면이 같은 조각을 쓴다 (기획 지시 2026-09-21, 보완 2026-09-21, 2026-11-07).
 *  - mode:     "온라인 강의" | "오프라인 멘토링" | "온라인/오프라인 병행" (역할 반영)
 *  - count:    "총 5회" | "총 5~8회"
 *  - hours:    "회차당 2시간"
 *  - unitFee:  "회차당 120,000원" | "온라인 회차당 120,000원 / 오프라인 회차당 200,000원"
 *  - totalFee: "600,000원" | "600,000원 ~ 1,000,000원" — 회차 × 단가 (전문가는 '얼마'를 알아야 한다)
 *  - single:   총 1회 — 이때는 회차당 단가 대신 의뢰비용 한 줄로 쓴다
 */
export type EngagementFeeTerms = {
  mode: string | null;
  count: string | null;
  hours: string | null;
  unitFee: string | null;
  totalFee: string | null;
  single: boolean;
};

/**
 * 비용 한 줄 — 문자·메일·공개 링크·수락서가 같은 문장을 쓴다.
 *  총 1회: "200,000원 (1회)" / 여러 회: "회차당 200,000원 × 총 3회 = 600,000원" / 단가만: "회차당 200,000원"
 */
export function feeTermsFeeLine(t: EngagementFeeTerms | null | undefined): string | null {
  if (!t) return null;
  if (t.single && t.totalFee) return `${t.totalFee} (1회)`;
  if (t.unitFee && t.totalFee && t.count) return `${t.unitFee} × ${t.count} = ${t.totalFee}`;
  if (t.unitFee) return t.unitFee;
  if (t.totalFee) return t.totalFee;
  return null;
}

export function engagementFeeTerms(
  s: SessionSchedule,
  unitOnline: number | null,
  unitOffline: number | null,
  roleType?: string | null
): EngagementFeeTerms {
  const countRange = sessionCount(s);
  const mode = s.deliveryMode ?? (unitOffline !== null ? "offline" : unitOnline !== null ? "online" : null);
  let unitFee: string | null = null;
  if (mode === "hybrid") {
    if (unitOnline !== null || unitOffline !== null) {
      unitFee = `온라인 회차당 ${unitOnline !== null ? formatWon(unitOnline) : "미정"} / 오프라인 회차당 ${
        unitOffline !== null ? formatWon(unitOffline) : "미정"
      }`;
    }
  } else if (mode === "online" && unitOnline !== null) {
    unitFee = `회차당 ${formatWon(unitOnline)}`;
  } else if (mode === "offline" && unitOffline !== null) {
    unitFee = `회차당 ${formatWon(unitOffline)}`;
  }
  const total = computeFeeTotal(s, unitOnline, unitOffline);
  return {
    mode: s.deliveryMode ? deliveryTermsLabel(s.deliveryMode, roleType) : null,
    count: countRange
      ? countRange.min === countRange.max
        ? `총 ${countRange.min}회`
        : `총 ${countRange.min}~${countRange.max}회`
      : null,
    hours: s.hoursPerSession ? `회차당 ${fmtHours(s.hoursPerSession)}시간` : null,
    unitFee,
    totalFee: total ? formatFeeTotal(total) : null,
    single: countRange !== null && countRange.min === 1 && countRange.max === 1,
  };
}

/** 조건 조각을 한 줄로 — "온라인/오프라인 병행 · 총 5회 · 회차당 2시간 · 회차당 200,000원 × 총 5회 = 1,000,000원" */
export function feeTermsToText(t: EngagementFeeTerms | null | undefined): string | null {
  if (!t) return null;
  const parts = [t.mode, t.count, t.hours, feeTermsFeeLine(t)].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 조건 조각이 모두 같은가 (묶음 문자에서 한 줄로 합칠 수 있는지) */
export function sameFeeTerms(a: EngagementFeeTerms | null, b: EngagementFeeTerms | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.mode === b.mode && a.count === b.count && a.hours === b.hours && a.unitFee === b.unitFee && a.totalFee === b.totalFee
  );
}

/**
 * 섭외 조건 한 줄 — 메일·후보 화면용. 아무 정보도 없으면 null.
 */
export function engagementTermsText(
  s: SessionSchedule,
  unitOnline: number | null,
  unitOffline: number | null
): string | null {
  return feeTermsToText(engagementFeeTerms(s, unitOnline, unitOffline));
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
