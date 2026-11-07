/**
 * 발주처 여러 곳 (기획 지시 2026-11-07) — 공동 발주 사업은 발주처가 둘 이상이다.
 * 저장은 projects.client_name 한 칸에 ' · '로 이어 붙인다 (마이그레이션 없음 —
 * 목록·내보내기·수락서 안내·견적서가 그 칸을 그대로 읽는다). 폼에서는 나눠 보여 준다.
 */
export const CLIENT_NAME_SEPARATOR = " · ";
export const CLIENT_NAME_MAX_EACH = 100;
export const CLIENT_NAME_MAX_COUNT = 5;

/** ' · '로 이어진 발주처 문자열 → 이름 배열 (빈 값 제외) */
export function splitClientNames(joined: string | null | undefined): string[] {
  if (!joined) return [];
  return joined
    .split(/\s·\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 이름 배열 → 저장용 문자열 (빈 값 제외, 중복 제거) */
export function joinClientNames(names: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.join(CLIENT_NAME_SEPARATOR);
}
