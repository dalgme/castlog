/**
 * 넘버링코드 생성 규칙 (Phase B-1) — 클라이언트·서버 공용.
 *
 * 형식: {MMDD}-{역할약어}-{순번2자리}   예) 0527-MEN-01
 *  - 날짜와 역할이 코드에 보이므로 현장에서 바로 식별된다.
 *  - 같은 테넌트 안에서 유일해야 하므로(unique index), 충돌 시 접미사를 붙인다.
 */
export const ROLE_CODE_ABBR: Record<string, string> = {
  host: "HST",
  lecturer: "LEC",
  mentor: "MEN",
  judge: "JDG",
  announcer: "ANN",
  assistant: "AST",
  other: "ETC",
};

export function buildSlotCode(
  slotDate: string,
  roleType: string,
  positionNo: number,
  suffix?: string
): string {
  const mmdd = slotDate.slice(5).replace("-", ""); // YYYY-MM-DD → MMDD
  const abbr = ROLE_CODE_ABBR[roleType] ?? "ETC";
  const no = String(positionNo).padStart(2, "0");
  return suffix ? `${mmdd}-${abbr}-${no}-${suffix}` : `${mmdd}-${abbr}-${no}`;
}

export const POSITION_STATUS_LABELS: Record<string, string> = {
  open: "미섭외",
  requested: "요청중",
  filled: "확정",
  canceled: "취소",
};

export const POSITION_STATUS_TONE: Record<
  string,
  "gray" | "amber" | "green" | "red"
> = {
  open: "gray",
  requested: "amber",
  filled: "green",
  canceled: "red",
};
