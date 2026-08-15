/**
 * 주민등록번호 마스킹 필터 (설계문서 §5 / rrn-phase2-secure-subsystem §10)
 *
 * 로그·에러·직렬화 파이프라인 **최전단**에서 평문 주민번호 패턴을 제거한다.
 * 평문 RRN이 로그·캐시·APM·클라이언트 상태에 남지 않도록 하는 안전망이며,
 * 정상 경로에서 애초에 평문을 다루지 않는 것이 1차 방어다(이건 2차 방어).
 *
 * 이 모듈은 순수 함수만 제공한다(복호화 능력 아님).
 */

// 6자리(생년월일) + 성별코드(1~4,5~8 외국인 포함) + 6자리. 하이픈/공백 허용.
const RRN_PATTERN = /\b(\d{6})[-\s]?([1-8]\d{6})\b/g;

/** 문자열 내 주민번호 패턴을 마스킹 (뒤 7자리 은닉). */
export function maskRrnInText(text: string): string {
  return text.replace(RRN_PATTERN, (_m, front: string) => `${front}-*******`);
}

/** 임의 값(객체·배열·문자열)을 순회하며 문자열에 한해 마스킹한 사본을 반환. */
export function redactRrn<T>(value: T): T {
  if (typeof value === "string") {
    return maskRrnInText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactRrn(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactRrn(v);
    }
    return out as T;
  }
  return value;
}

/** 화면 표기용 마스킹: 전체를 받되 앞 6자리 + 뒤 1자리만 노출 (예: 900101-1******). */
export function maskRrnForDisplay(rrn: string): string {
  const digits = rrn.replace(/\D/g, "");
  if (digits.length !== 13) return "*".repeat(Math.max(rrn.length, 8));
  return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
}
