/**
 * 프로젝트 담당 역할 (operations).
 *
 * PM(책임) · 부PM(부책임) · 담당. 프로젝트당 PM·부PM은 각 1명.
 * 열람 범위는 '배정 여부'로 결정되고, 역할은 책임 소재를 표시하는 운영 정보다 —
 * 역할별로 권한을 갈라 판정 규칙을 복잡하게 만들지 않는다.
 *
 * 서버 액션 파일("use server")은 async 함수만 export할 수 있으므로 상수는 여기에 둔다.
 */

export const ASSIGNMENT_ROLES = ["pm", "deputy_pm", "member"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  pm: "PM",
  deputy_pm: "부PM",
  member: "담당",
};

export function isAssignmentRole(value: string): value is AssignmentRole {
  return (ASSIGNMENT_ROLES as readonly string[]).includes(value);
}

export function assignmentRoleLabel(value: string | null | undefined): string {
  return value && isAssignmentRole(value) ? ASSIGNMENT_ROLE_LABELS[value] : "담당";
}

/** 정렬용 — PM · 부PM · 담당 순 */
export function assignmentRoleRank(value: string): number {
  if (value === "pm") return 0;
  if (value === "deputy_pm") return 1;
  return 2;
}
