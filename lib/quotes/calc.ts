/**
 * 견적 · 내부실견적 · 정산 계산 (기획 지시 2026-09-09 — 렛츠 양식 기준).
 *
 * 순수 함수만 둔다 — 화면(입력 즉시 재계산)과 서버(저장·엑셀 내보내기)가
 * **같은 식**을 쓰게 하기 위해서다. 금액이 화면과 파일에서 다르면 그 문서는
 * 못 쓴다.
 *
 * 반올림 규칙: 원 단위 미만은 버린다(내림). 부가세·환급처럼 비율에서 나온
 * 값도 원 단위로 내림해 합산한다 — 엑셀이 표시하는 값과 어긋나지 않게.
 */

/** 최종 제안가 절사 (기획 지시 01) */
export const ROUNDING_MODES = ["none", "floor_1k", "floor_10k", "floor_100k"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  none: "선택 안함",
  floor_1k: "1,000원 미만 절사 (천 단위 버림)",
  floor_10k: "10,000원 미만 절사 (만 단위 버림)",
  floor_100k: "100,000원 미만 절사 (십만 단위 버림)",
};

export function isRoundingMode(v: unknown): v is RoundingMode {
  return typeof v === "string" && (ROUNDING_MODES as readonly string[]).includes(v);
}

const ROUNDING_UNIT: Record<RoundingMode, number> = {
  none: 1,
  floor_1k: 1_000,
  floor_10k: 10_000,
  floor_100k: 100_000,
};

/** 원 단위 내림 — 음수는 0에 가깝게(절사) 다룬다 */
export function wons(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.floor(-value) : Math.floor(value);
}

export function applyRounding(total: number, mode: RoundingMode): number {
  const unit = ROUNDING_UNIT[mode] ?? 1;
  if (unit <= 1) return wons(total);
  return Math.floor(wons(total) / unit) * unit;
}

/** 1,000 단위 쉼표 (기획 지시 01) */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return Math.round(value).toLocaleString("ko-KR");
}

/**
 * 수량·횟수·일수 표시 — 소수를 반올림하면 안 된다 (리뷰 M4).
 * 0.5명 × 1,000,000원 = 500,000원인데 수량이 '1'로 보이면 발주처에 나가는
 * 종이 위에서 산식이 맞지 않는다.
 */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/** 비율 표시 — 12.3% */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "-";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** 쉼표·원 표기가 섞인 입력에서 숫자만 뽑는다 */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ── 견적서 ──────────────────────────────────────────────────────────────────

export type QuoteItemCalcInput = {
  id: string;
  section: string | null;
  qty: number;
  times: number;
  days: number;
  unitPrice: number;
};

export type QuoteParams = {
  indirectRate: number;
  profitRate: number;
  vatRate: number;
  rounding: RoundingMode;
};

/** 한 줄 금액 = 수량 × 횟수 × 일수 × 단가 */
export function lineAmount(item: {
  qty: number;
  times: number;
  days: number;
  unitPrice: number;
}): number {
  return wons(item.qty * item.times * item.days * item.unitPrice);
}

export type QuoteSection = {
  /** 표시용 이름. 비어 있으면 '(구분 없음)' */
  name: string | null;
  itemIds: string[];
  subtotal: number;
};

export type QuoteTotals = {
  sections: QuoteSection[];
  amounts: Record<string, number>;
  /** 소계 합 (A+B+C…) */
  directTotal: number;
  indirect: number;
  /** 합계 (A+B+C+D) */
  totalWithIndirect: number;
  profit: number;
  /** 합계 (A+B+C+D+E) */
  totalWithProfit: number;
  vat: number;
  /** 총계 (부가세 포함) */
  grandTotal: number;
  /** 절사 후 제안금액 */
  proposal: number;
  /** 절사액 (총계 − 제안금액) */
  trimmed: number;
};

/**
 * 견적 합계. 같은 항목(section)이 연달아 나오면 한 묶음으로 보고 소계를 낸다 —
 * 체크리스트 분류 묶음과 같은 규칙이라 표에서 순서를 그대로 읽을 수 있다.
 */
export function buildQuoteTotals(
  items: QuoteItemCalcInput[],
  params: QuoteParams
): QuoteTotals {
  const amounts: Record<string, number> = {};
  const sections: QuoteSection[] = [];
  for (const item of items) {
    const amount = lineAmount(item);
    amounts[item.id] = amount;
    const name = item.section?.trim() || null;
    const last = sections[sections.length - 1];
    if (last && last.name === name) {
      last.itemIds.push(item.id);
      last.subtotal += amount;
    } else {
      sections.push({ name, itemIds: [item.id], subtotal: amount });
    }
  }
  const directTotal = sections.reduce((sum, s) => sum + s.subtotal, 0);
  const indirect = wons(directTotal * params.indirectRate);
  const totalWithIndirect = directTotal + indirect;
  const profit = wons(totalWithIndirect * params.profitRate);
  const totalWithProfit = totalWithIndirect + profit;
  const vat = wons(totalWithProfit * params.vatRate);
  const grandTotal = totalWithProfit + vat;
  const proposal = applyRounding(grandTotal, params.rounding);
  return {
    sections,
    amounts,
    directTotal,
    indirect,
    totalWithIndirect,
    profit,
    totalWithProfit,
    vat,
    grandTotal,
    proposal,
    trimmed: grandTotal - proposal,
  };
}

// ── 내부실견적 · 정산 ────────────────────────────────────────────────────────

export type CostLineCalcInput = {
  id: string;
  baseAmount: number;
  spend: number;
  vatRefundable: boolean;
};

export type CostFixedInput = {
  travelAmount: number;
  travelRefundable: boolean;
  reserveAmount: number;
  reserveRefundable: boolean;
};

export type CostBase = {
  /** 왼쪽 문서의 계약금액 부가세 */
  baseVat: number;
  /** 왼쪽 문서의 절사액 — 받지 못하는 금액이라 수익에서 뺀다 */
  baseTrimmed: number;
  /** 제안금액 — 수익률의 분모 */
  baseProposal: number;
};

export type CostLineResult = { refund: number; profit: number };

export type CostTotals = {
  lines: Record<string, CostLineResult>;
  travel: CostLineResult;
  reserve: CostLineResult;
  /** 계약금액 부가세 행 — 실제 납부액(계약 부가세 − 환급 합계)과 수익(환급) */
  vatRow: { spend: number; profit: number };
  refundTotal: number;
  /** 지출 합계 (항목 + 출장교통비 + 예비비 + 부가세 납부액) */
  spendTotal: number;
  /** 수익 합계 (절사액 차감 반영) */
  profitTotal: number;
  /** 수익률 = 수익 합계 ÷ 제안금액 */
  profitRatio: number | null;
};

/** 부가세 환급액 — 공급대가에서 세액을 뽑는다 (지출 ÷ 1.1 × 0.1) */
export function vatRefund(spend: number, refundable: boolean): number {
  if (!refundable) return 0;
  return wons(spend / 1.1 / 10);
}

/**
 * 내부실견적·정산 합계 (기획 지시 02·03 — 같은 계산).
 *
 * 하단 세 영역은 필수다: 출장교통비 · 사업담당자 예비비 · 계약금액 부가세.
 * 앞의 둘은 견적에 대응 항목이 없는 순수 지출이라 수익이 그만큼 깎이고,
 * 부가세 행은 계약 부가세에서 환급 합계를 뺀 실제 납부액이 지출, 환급이 수익이다.
 */
export function buildCostTotals(
  lines: CostLineCalcInput[],
  fixed: CostFixedInput,
  base: CostBase
): CostTotals {
  const result: Record<string, CostLineResult> = {};
  let lineSpend = 0;
  let lineProfit = 0;
  let refundTotal = 0;
  for (const line of lines) {
    const refund = vatRefund(line.spend, line.vatRefundable);
    const profit = wons(line.baseAmount - line.spend);
    result[line.id] = { refund, profit };
    lineSpend += wons(line.spend);
    lineProfit += profit;
    refundTotal += refund;
  }

  const travelRefund = vatRefund(fixed.travelAmount, fixed.travelRefundable);
  const reserveRefund = vatRefund(fixed.reserveAmount, fixed.reserveRefundable);
  refundTotal += travelRefund + reserveRefund;
  const travel: CostLineResult = { refund: travelRefund, profit: -wons(fixed.travelAmount) };
  const reserve: CostLineResult = { refund: reserveRefund, profit: -wons(fixed.reserveAmount) };

  // 계약금액 부가세 — 받은 부가세에서 환급받는 매입세액을 뺀 만큼을 납부한다
  const vatSpend = wons(base.baseVat - refundTotal);
  const vatRow = { spend: vatSpend, profit: refundTotal };

  const spendTotal =
    lineSpend + wons(fixed.travelAmount) + wons(fixed.reserveAmount) + vatSpend;
  const profitTotal =
    lineProfit + travel.profit + reserve.profit + vatRow.profit - wons(base.baseTrimmed);

  return {
    lines: result,
    travel,
    reserve,
    vatRow,
    refundTotal,
    spendTotal,
    profitTotal,
    profitRatio: base.baseProposal > 0 ? profitTotal / base.baseProposal : null,
  };
}
