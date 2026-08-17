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

/** 날짜 + 시간 구간을 수락서 표기(2026. 5. 27.(수) 14:00 ~ 15:30)로 조합 */
export function formatEventSchedule(
  startsOn: string | null,
  endsOn: string | null,
  startsTime: string | null,
  endsTime: string | null
): string | null {
  if (!startsOn) return null;
  const d = new Date(`${startsOn}T00:00:00`);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const base = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.(${wd})`;
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
  const s = hhmm(startsTime);
  const e = hhmm(endsTime);

  // 여러 날에 걸치는 경우 날짜 범위를 우선 표기
  if (endsOn && endsOn !== startsOn) {
    const d2 = new Date(`${endsOn}T00:00:00`);
    const wd2 = ["일", "월", "화", "수", "목", "금", "토"][d2.getDay()];
    const tail = `${d2.getFullYear()}. ${d2.getMonth() + 1}. ${d2.getDate()}.(${wd2})`;
    return s && e ? `${base} ~ ${tail} ${s} ~ ${e}` : `${base} ~ ${tail}`;
  }
  if (s && e) return `${base} ${s} ~ ${e}`;
  if (s) return `${base} ${s}`;
  return base;
}
