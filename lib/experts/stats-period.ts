/**
 * 전문가 대시보드 활동 통계의 조회 기간 계산 (한국 표준시 KST 기준).
 *
 * 기본값은 "지난 달"(1일~말일). 프리셋(이번 달/지난 달/분기/올해)과
 * 직접 설정(from~to 달력)을 URL 파라미터로 받아 [fromMs, toMs) 구간으로 해석한다.
 * 통계는 timestamptz(UTC) 값과 epoch(ms)로 비교하므로 경계도 epoch로 돌려준다.
 */
const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export type PeriodParams = {
  period?: string;
  from?: string;
  to?: string;
};

export type PeriodRange = {
  fromMs: number;
  /** 상한(미포함) */
  toMs: number;
  label: string;
  preset: "thisMonth" | "lastMonth" | "quarter" | "year" | "custom";
  from?: string;
  to?: string;
};

/** epoch(ms) → KST 달력 구성요소 */
function kstParts(ms: number) {
  const d = new Date(ms + KST_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/** KST 기준 해당 일자 00:00:00의 epoch(ms) (월 음수/초과는 자동 이월) */
function kstStartOfDay(y: number, m: number, d: number) {
  return Date.UTC(y, m, d, 0, 0, 0) - KST_OFFSET;
}

function parseYmd(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function resolvePeriod(params: PeriodParams, nowMs: number): PeriodRange {
  // 직접 설정 (달력) 우선
  if (params.from && params.to) {
    const f = parseYmd(params.from);
    const t = parseYmd(params.to);
    if (f && t) {
      let fromMs = kstStartOfDay(f.y, f.m, f.d);
      let toMs = kstStartOfDay(t.y, t.m, t.d) + DAY; // 종료일 포함
      let fromStr = params.from;
      let toStr = params.to;
      if (fromMs > toMs) {
        [fromMs, toMs] = [kstStartOfDay(t.y, t.m, t.d), kstStartOfDay(f.y, f.m, f.d) + DAY];
        [fromStr, toStr] = [toStr, fromStr];
      }
      return {
        fromMs,
        toMs,
        preset: "custom",
        label: `${fromStr} ~ ${toStr}`,
        from: fromStr,
        to: toStr,
      };
    }
  }

  const { y, m } = kstParts(nowMs);
  const preset = params.period;

  if (preset === "thisMonth") {
    return {
      fromMs: kstStartOfDay(y, m, 1),
      toMs: nowMs + 1,
      preset: "thisMonth",
      label: `${y}년 ${m + 1}월 (이번 달)`,
    };
  }
  if (preset === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    return {
      fromMs: kstStartOfDay(y, qStartMonth, 1),
      toMs: nowMs + 1,
      preset: "quarter",
      label: `${y}년 ${Math.floor(m / 3) + 1}분기`,
    };
  }
  if (preset === "year") {
    return {
      fromMs: kstStartOfDay(y, 0, 1),
      toMs: nowMs + 1,
      preset: "year",
      label: `${y}년`,
    };
  }

  // 기본값: 지난 달 (1일~말일)
  const fromMs = kstStartOfDay(y, m - 1, 1);
  const toMs = kstStartOfDay(y, m, 1);
  const lm = kstParts(fromMs);
  return {
    fromMs,
    toMs,
    preset: "lastMonth",
    label: `${lm.y}년 ${lm.m + 1}월 (지난 달)`,
  };
}

/** ISO 문자열 시각이 구간 [fromMs, toMs)에 포함되는지 */
export function inRange(iso: string | null | undefined, range: PeriodRange) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.fromMs && t < range.toMs;
}
