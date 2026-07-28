/**
 * 한국 휴대폰 번호 정규화 (전문가 OTP 인증·중복 판정 공통)
 *
 * experts.phone이 중복 판정 기준(설계문서 3.2)이므로 저장·조회 전에
 * 반드시 동일한 정규화를 거쳐야 한다.
 */

/** 입력값을 E.164(+82...)로 정규화. 유효한 휴대폰 번호가 아니면 null. */
export function normalizeKrMobileE164(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("82")) {
    digits = `0${digits.slice(2)}`;
  }
  if (!/^01[016789]\d{7,8}$/.test(digits)) {
    return null;
  }
  return `+82${digits.slice(1)}`;
}

/** E.164 → 국내 표기(010-1234-5678). 표시 용도. */
export function formatKrMobile(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  if (local.length === 11) {
    return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return local;
}
