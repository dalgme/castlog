/**
 * 원천징수 참고 계산 (단계 12 — 기획 확정: 소득유형별 실지급/원천징수/총비용)
 *
 * 주의: 이 계산은 **참고치**다. 세액 확정은 세무 검토를 거친다 — 화면에 고지한다.
 * 자동 계산을 지급 판정의 단독 근거로 쓰지 않는다 (CLAUDE.md 14-1 정신).
 *
 * 기준 (2026 현행 일반 규칙 — 세율 변경 시 이 모듈만 수정):
 *  - 사업소득(개인): 소득세 3% + 지방소득세 0.3% = 3.3%.
 *    소액부징수 — 건당 소득세 1,000원 미만이면 징수하지 않음.
 *  - 기타소득(개인): 필요경비 60% 인정 → 과세표준 = 지급액×40%.
 *    소득세 20% + 지방소득세 2% (지급액 기준 실효 8.8%).
 *    과세최저한 — 기타소득금액(경비 차감 후) 5만원 이하면 징수하지 않음.
 *  - 사업자: 원천징수 없음 (세금계산서 수취, 부가세는 별도 처리).
 */

export type PaymentType = "business_income" | "other_income" | "business";

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  business_income: "사업소득 (3.3%)",
  other_income: "기타소득 (8.8%)",
  business: "사업자 (세금계산서)",
};

export type WithholdingResult = {
  gross: number; // 총비용(계약금액)
  withholding: number; // 원천징수 합계 (참고)
  net: number; // 실지급액
};

/** 소득유형별 원천징수 참고 계산 */
export function calculateWithholding(
  paymentType: PaymentType,
  gross: number
): WithholdingResult {
  if (gross <= 0) {
    return { gross: Math.max(0, gross), withholding: 0, net: Math.max(0, gross) };
  }

  if (paymentType === "business") {
    return { gross, withholding: 0, net: gross };
  }

  if (paymentType === "business_income") {
    const incomeTax = Math.floor(gross * 0.03);
    // 소액부징수: 건당 소득세 1,000원 미만 징수 제외
    if (incomeTax < 1000) {
      return { gross, withholding: 0, net: gross };
    }
    const localTax = Math.floor(incomeTax * 0.1);
    const withholding = incomeTax + localTax;
    return { gross, withholding, net: gross - withholding };
  }

  // other_income — 필요경비 60%
  const taxable = Math.floor(gross * 0.4);
  // 과세최저한: 기타소득금액 5만원 이하 징수 제외
  if (taxable <= 50000) {
    return { gross, withholding: 0, net: gross };
  }
  const incomeTax = Math.floor(taxable * 0.2);
  const localTax = Math.floor(incomeTax * 0.1);
  const withholding = incomeTax + localTax;
  return { gross, withholding, net: gross - withholding };
}

export function isPaymentType(value: string | null | undefined): value is PaymentType {
  return (
    value === "business_income" || value === "other_income" || value === "business"
  );
}
