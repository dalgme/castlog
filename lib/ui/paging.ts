/**
 * 목록 페이지네이션 공통 계산 — 클라이언트·서버 공용이라 server-only를 두지 않는다.
 *
 * 왜 만드는가: 목록들이 limit(300) 같은 고정 상한으로 조용히 잘리고 있었다.
 * 잘린 사실을 사용자가 알 수 없는 게 가장 나쁘다 — 전체 건수를 함께 보여주고
 * 넘길 수 있게 한다.
 */

export type PageInfo = {
  page: number; // 1-based
  pageSize: number;
  /** supabase .range(from, to) 인자 */
  from: number;
  to: number;
};

export function resolvePage(raw: string | undefined, pageSize: number): PageInfo {
  const parsed = Number.parseInt(raw ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function totalPages(count: number | null, pageSize: number): number {
  if (!count || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / pageSize));
}

/** 현재 쿼리스트링을 유지한 채 특정 키만 바꾼 경로를 만든다. */
export function withParams(
  basePath: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * 검색어에서 휴대폰 조회용 숫자열을 뽑는다.
 * experts.phone은 E.164(+8210…)로 저장되므로 '010-1234'로는 안 잡힌다.
 * 앞자리 0을 떼고 숫자만 남겨 부분 일치에 쓴다 (01012345678 → 1012345678).
 */
export function phoneSearchFragment(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.startsWith("0") ? digits.slice(1) : digits;
}
