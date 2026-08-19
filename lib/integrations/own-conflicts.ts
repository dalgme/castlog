import type { OwnConflict } from "./slot-candidates";

/**
 * 자사 겹침 문구 (클라이언트·서버 공용 — server-only 아님).
 *
 * 타사 건과 달리 우리 회사 안의 일은 어느 사업 어느 세션인지까지 보여 준다.
 * "겹칩니다"만으로는 담당자가 판단을 못 한다 — 오전 다른 사업이면 오후 건은
 * 얼마든지 가능하고, 같은 시간대면 불가다.
 */

const KIND_LABEL: Record<OwnConflict["kind"], string> = {
  assigned: "배정 중",
  requested: "섭외 요청 중",
  accepted: "확정",
};

export function ownConflictKindLabel(kind: OwnConflict["kind"]): string {
  return KIND_LABEL[kind];
}

/** "2026-08-23 16:00~18:00" — 시간이 없으면 날짜만 */
export function conflictSchedule(conflict: OwnConflict): string {
  if (!conflict.startsTime) return conflict.startsOn;
  const start = conflict.startsTime.slice(0, 5);
  const end = conflict.endsTime ? `~${conflict.endsTime.slice(0, 5)}` : "";
  return `${conflict.startsOn} ${start}${end}`;
}

/** 한 줄 요약 — "[사업명] 세션명 · 2026-08-23 16:00~18:00 · 장소 (확정)" */
export function describeOwnConflict(conflict: OwnConflict): string {
  const parts = [
    conflict.projectName ? `[${conflict.projectName}]` : null,
    conflict.sessionName ?? conflict.roleDescription,
    conflictSchedule(conflict),
    conflict.locationName,
  ].filter(Boolean);
  return `${parts.join(" · ")} (${KIND_LABEL[conflict.kind]})`;
}

/** 다른 사업에 이미 물려 있는가 — 후보 목록의 '타사업 배정 중' 표시 기준 */
export function hasOtherProjectConflict(conflicts: OwnConflict[]): boolean {
  return conflicts.some((c) => c.otherProject);
}
