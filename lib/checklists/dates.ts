/**
 * 체크리스트 날짜 표기 (기획 지시 2026-09-20).
 * 입력은 "9/6"처럼 월/일만, 표시는 "09월 06일(금)". 연도는 앞 칸에 자동으로 들어가고
 * +·−로만 고친다 — 한 해에 수십 개 날짜를 넣는 사람에게 연도 네 자리는 매번 군더더기다.
 * 순수 함수만 둔다 — 화면(입력·표시)과 서버 검증이 같은 규칙을 쓴다.
 */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function splitIso(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isValidYmd(y, mo, d)) return null;
  return { y, m: mo, d };
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2026-09-06" → "09월 06일(일)" */
export function formatKoreanDate(iso: string | null | undefined): string {
  const p = splitIso(iso);
  if (!p) return "";
  const w = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${String(p.m).padStart(2, "0")}월 ${String(p.d).padStart(2, "0")}일(${w})`;
}

/** "2026-09-06" → "2026년 09월 06일(일)" — 플랫폼 공통 날짜 표기 (기획 지시 2026-09-21) */
export function formatKoreanDateFull(iso: string | null | undefined): string {
  const p = splitIso(iso);
  if (!p) return "";
  const w = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${p.y}년 ${String(p.m).padStart(2, "0")}월 ${String(p.d).padStart(2, "0")}일(${w})`;
}

/** "2026-09-06" → "9/6" (편집 칸에 넣는 짧은 표기) */
export function toMonthDay(iso: string | null | undefined): string {
  const p = splitIso(iso);
  return p ? `${p.m}/${p.d}` : "";
}

/**
 * "9/6" · "09.06" · "9-6" · "2026/9/6" · "2026-09-06" → ISO.
 * 연도가 없으면 fallbackYear. 형식·범위가 틀리면 null.
 */
export function parseMonthDay(input: string, fallbackYear: number): string | null {
  const s = input.trim();
  if (!s) return null;
  const full = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(s);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    return isValidYmd(y, m, d) ? toIso(y, m, d) : null;
  }
  const md = /^(\d{1,2})[\/.\-](\d{1,2})$/.exec(s);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    return isValidYmd(fallbackYear, m, d) ? toIso(fallbackYear, m, d) : null;
  }
  // "0906" 처럼 붙여 쓴 네 자리도 받는다
  const compact = /^(\d{2})(\d{2})$/.exec(s);
  if (compact) {
    const m = Number(compact[1]);
    const d = Number(compact[2]);
    return isValidYmd(fallbackYear, m, d) ? toIso(fallbackYear, m, d) : null;
  }
  return null;
}

/** 연도만 바꾼다 — 2/29처럼 그 해에 없는 날이면 2/28로 당긴다 */
export function shiftYear(iso: string, delta: number): string | null {
  const p = splitIso(iso);
  if (!p) return null;
  const y = p.y + delta;
  if (y < 2000 || y > 2100) return null;
  let d = p.d;
  while (d > 28 && !isValidYmd(y, p.m, d)) d -= 1;
  return toIso(y, p.m, d);
}
