/**
 * 프로젝트 담당 역할 (operations).
 *
 * PL(총괄) · PM(책임) · 부PM(부책임) · 담당. PL·PM은 프로젝트당 각 1명,
 * 부PM·담당은 인원 제한 없음. PL은 PM을 겸임할 수 있다 — 배정은
 * '한 사람 = 한 행' 모델을 유지하므로 겸임은 별도 역할 'pl_pm'으로 표현한다.
 * 열람 범위는 '배정 여부'로 결정되고, 역할은 책임 소재를 표시하는 운영 정보다 —
 * 역할별로 권한을 갈라 판정 규칙을 복잡하게 만들지 않는다.
 *
 * 서버 액션 파일("use server")은 async 함수만 export할 수 있으므로 상수는 여기에 둔다.
 */

export const ASSIGNMENT_ROLES = [
  "pl",
  "pl_pm",
  "pm",
  "deputy_pm",
  "member",
] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  pl: "PL",
  pl_pm: "PL·PM 겸임",
  pm: "PM",
  deputy_pm: "부PM",
  member: "담당",
};

export function isAssignmentRole(value: string): value is AssignmentRole {
  return (ASSIGNMENT_ROLES as readonly string[]).includes(value);
}

/** PL 자리(총괄)를 차지하는 역할인가 — 겸임 포함 */
export function isPlRole(value: string | null | undefined): boolean {
  return value === "pl" || value === "pl_pm";
}

/** PM 자리(책임)를 차지하는 역할인가 — 겸임 포함 */
export function isPmRole(value: string | null | undefined): boolean {
  return value === "pm" || value === "pl_pm";
}

export function assignmentRoleLabel(value: string | null | undefined): string {
  return value && isAssignmentRole(value) ? ASSIGNMENT_ROLE_LABELS[value] : "담당";
}

/** 정렬용 — PL · PL·PM 겸임 · PM · 부PM · 담당 순 */
export function assignmentRoleRank(value: string): number {
  if (value === "pl") return 0;
  if (value === "pl_pm") return 1;
  if (value === "pm") return 2;
  if (value === "deputy_pm") return 3;
  return 4;
}
