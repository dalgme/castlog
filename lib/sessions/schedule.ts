/**
 * 세션 일정 모델 (기획 지시 2026-09-21).
 *
 * 세션은 날짜 유형을 갖는다:
 *  - continuous(연속형) = 시작일~종료일 한 덩어리. 시작일·종료일의 시각은 선택.
 *    회차는 최소~최대(확정이면 최소만). 시각이 없으면 캘린더 상단에 긴 막대로.
 *  - individual(개별선택형) = 특정 날짜 여러 개. 날짜 수 = 회차.
 * 진행 방식(온라인/오프라인/병행)은 회당 단가 계산의 축이다 (lib/sessions/fees).
 *
 * 순수 함수만 둔다 — 캘린더·세션 목록·섭외후보·결재·안내문자가 같은 표기를 쓴다.
 */

export type DateKind = "continuous" | "individual";
export type DeliveryMode = "online" | "offline" | "hybrid";

export const DATE_KIND_LABELS: Record<DateKind, string> = {
  continuous: "연속형",
  individual: "개별선택형",
};

export const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  online: "온라인",
  offline: "오프라인",
  hybrid: "온·오프라인 병행",
};

export function isDateKind(v: unknown): v is DateKind {
  return v === "continuous" || v === "individual";
}
export function isDeliveryMode(v: unknown): v is DeliveryMode {
  return v === "online" || v === "offline" || v === "hybrid";
}

export type SessionDate = { date: string; startsTime: string | null; endsTime: string | null };

export type SessionSchedule = {
  dateKind: DateKind;
  /** 첫 날 (= engagement_slots.slot_date) */
  startDate: string;
  /** 마지막 날 (= period_end_date). 하루짜리면 null */
  endDate: string | null;
  startsTime: string | null;
  endsTime: string | null;
  /** 연속형 종료일의 시각 */
  endStartsTime: string | null;
  endEndsTime: string | null;
  /** 개별선택형 날짜들 (연속형이면 빈 배열) */
  dates: SessionDate[];
  countMin: number | null;
  countMax: number | null;
  /** 병행일 때 온라인·오프라인 회차 (비우면 범위로 표시) */
  onlineCount: number | null;
  offlineCount: number | null;
  deliveryMode: DeliveryMode | null;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function fmtDate(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${withYear ? `${y}. ` : ""}${mo}/${d}(${wd})`;
}

export function fmtTime(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

function timeSpan(starts: string | null, ends: string | null): string {
  const s = fmtTime(starts);
  const e = fmtTime(ends);
  if (s && e) return ` ${s}~${e}`;
  if (s) return ` ${s}`;
  if (e) return ` ~${e}`;
  return "";
}

/** 회차 — 개별선택형은 날짜 수, 연속형은 입력한 최소~최대 */
export function sessionCount(s: SessionSchedule): { min: number; max: number } | null {
  if (s.dateKind === "individual") {
    const n = s.dates.length > 0 ? s.dates.length : 1;
    return { min: n, max: n };
  }
  if (s.countMin === null) return null;
  return { min: s.countMin, max: Math.max(s.countMax ?? s.countMin, s.countMin) };
}

export function countLabel(s: SessionSchedule): string | null {
  const c = sessionCount(s);
  if (!c) return null;
  return c.min === c.max ? `${c.min}회` : `${c.min}~${c.max}회`;
}

/** 병행 회차 표기 — "온라인 3회 · 오프라인 2회" (둘 다 있을 때만) */
export function hybridCountLabel(s: SessionSchedule): string | null {
  if (s.deliveryMode !== "hybrid" || s.onlineCount === null || s.offlineCount === null) return null;
  return `온라인 ${s.onlineCount}회 · 오프라인 ${s.offlineCount}회`;
}

/** 일정 줄 — 개별선택형은 날짜마다 한 줄, 연속형은 한 줄 */
export function scheduleLines(s: SessionSchedule, withYear = false): string[] {
  if (s.dateKind === "individual" && s.dates.length > 0) {
    return s.dates.map((d) => `${fmtDate(d.date, withYear)}${timeSpan(d.startsTime, d.endsTime)}`);
  }
  const head = `${fmtDate(s.startDate, withYear)}${timeSpan(s.startsTime, s.endsTime)}`;
  if (!s.endDate || s.endDate === s.startDate) return [head];
  const tail = `${fmtDate(s.endDate, withYear)}${timeSpan(s.endStartsTime, s.endEndsTime)}`;
  return [`${head} ~ ${tail}`];
}

/** 한 줄 요약 — "9/1(월) 10:00~12:00 ~ 9/5(금) · 5회 · 온라인" */
export function describeSchedule(s: SessionSchedule, opts?: { withYear?: boolean; withMeta?: boolean }): string {
  const lines = scheduleLines(s, opts?.withYear);
  const parts = [lines.join(", ")];
  if (opts?.withMeta !== false) {
    const c = hybridCountLabel(s) ?? countLabel(s);
    if (c) parts.push(c);
    if (s.deliveryMode) parts.push(DELIVERY_LABELS[s.deliveryMode]);
  }
  return parts.join(" · ");
}

/** 이 세션이 차지하는 날짜 전부 (연속형은 범위를 펼친다) — 캘린더 열 생성용 */
export function allDatesOf(s: SessionSchedule): string[] {
  if (s.dateKind === "individual" && s.dates.length > 0) return s.dates.map((d) => d.date);
  const out: string[] = [];
  const end = s.endDate ?? s.startDate;
  let t = Date.parse(`${s.startDate}T00:00:00Z`);
  const endT = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(endT)) return [s.startDate];
  for (let i = 0; t <= endT && i < 400; i += 1, t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 연속형인데 시각이 하나도 없다 — 상단 긴 막대로만 그린다 */
export function isAllDayBar(s: SessionSchedule): boolean {
  return s.dateKind === "continuous" && !s.startsTime && !s.endStartsTime;
}

/** 기존 행(단일 날짜 세션)을 새 모델로 — 마이그레이션 전 데이터·레거시 폴백 */
export function legacySchedule(row: {
  slot_date: string;
  period_end_date: string | null;
  starts_time: string | null;
  ends_time: string | null;
}): SessionSchedule {
  const continuous = row.period_end_date !== null && row.period_end_date !== row.slot_date;
  return {
    dateKind: continuous ? "continuous" : "individual",
    startDate: row.slot_date,
    endDate: row.period_end_date,
    startsTime: row.starts_time,
    endsTime: row.ends_time,
    endStartsTime: null,
    endEndsTime: null,
    dates: continuous ? [] : [{ date: row.slot_date, startsTime: row.starts_time, endsTime: row.ends_time }],
    countMin: null,
    countMax: null,
    onlineCount: null,
    offlineCount: null,
    deliveryMode: null,
  };
}
