/**
 * 섭외 구분(역할 유형) — 수락서 '구분' 체크 항목 (클라이언트·서버 공용).
 * 근거: 사용자 제공 수락서 양식(진행·강사·멘토링/컨설팅·아르바이트·심사위원).
 * 세부 역할 설명은 role_description(자유문)으로 별도 유지한다.
 */
export const ENGAGEMENT_ROLE_TYPES = {
  host: "진행",
  lecturer: "강사",
  mentor: "멘토링/컨설팅",
  judge: "심사위원",
  announcer: "아나운서",
  assistant: "아르바이트/보조",
  other: "기타",
} as const;

export type EngagementRoleType = keyof typeof ENGAGEMENT_ROLE_TYPES;

export function roleTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ENGAGEMENT_ROLE_TYPES[value as EngagementRoleType] ?? value;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-09-07" → "2026년 09월 07일(월)" — 플랫폼 공통 정식 표기 (기획 지시 2026-09-21) */
function formalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${m[1]}년 ${m[2]}월 ${m[3]}일(${wd})`;
}

/**
 * 날짜 + 시간 구간 → 문자·공개 링크·수락서 표기 "2026년 09월 07일(월) 10:30~14:30".
 * 보정 2026-11-07: 종전 "2026. 9. 7.(월)" 표기는 세션 일정 문구("2026. 9/7(월)")와도 달라
 * 같은 프로젝트의 문자 세 통이 세 가지 날짜 표기로 나갔다 — 정식 표기 하나로 통일.
 */
export function formatEventSchedule(
  startsOn: string | null,
  endsOn: string | null,
  startsTime: string | null,
  endsTime: string | null
): string | null {
  if (!startsOn) return null;
  const base = formalDate(startsOn);
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
  const s = hhmm(startsTime);
  const e = hhmm(endsTime);
  const span = s && e ? `${s}~${e}` : s ? s : e ? `~${e}` : null;

  // 여러 날에 걸치는 경우 날짜 범위를 우선 표기
  if (endsOn && endsOn !== startsOn) {
    const tail = formalDate(endsOn);
    return span ? `${base} ~ ${tail} ${span}` : `${base} ~ ${tail}`;
  }
  return span ? `${base} ${span}` : base;
}

/**
 * 회신 마감 등 시각 포함 정식 표기 (KST) — "2026년 11월 21일(토) 17:46".
 * withYear=false면 "11월 21일(토) 17:46", withTime=false면 날짜만.
 */
export function formatKstDateTimeFull(
  iso: string,
  opts?: { withYear?: boolean; withTime?: boolean }
): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const wd = WEEKDAYS[d.getUTCDay()];
  const date = `${opts?.withYear === false ? "" : `${y}년 `}${mo}월 ${day}일(${wd})`;
  if (opts?.withTime === false) return date;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}
