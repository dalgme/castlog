import {
  GRADE_LABELS,
  gradeAtLeast,
  gradeRank,
  isUserGrade,
  type UserGrade,
} from "@/lib/auth/grades";
import {
  ASSIGNMENT_ROLE_LABELS,
  type AssignmentRole,
} from "./assignment-roles";

/**
 * 프로젝트 역할별 최소 레벨 (기획 확정 2026-08-23 — 회사별 조정 가능).
 *
 * 기본값: PL=레벨 3 · PM=레벨 4 · 부PM=레벨 5 · 담당=레벨 6.
 * 회사는 임직원 설정에서 역할마다 다른 레벨을 적용할 수 있다
 * (tenant_assignment_role_rules). PL·PM 겸임(pl_pm)은 별도 설정이 아니라
 * PL·PM 중 더 높은 쪽을 자동으로 따른다.
 *
 * DB 트리거(app.enforce_assignment_role_grade)가 같은 규칙으로 최종 강제한다.
 * 클라이언트에서도 임포트될 수 있으므로 server-only를 붙이지 않는다.
 */

export const RULE_ROLES = ["pl", "pm", "deputy_pm", "member"] as const;
export type RuleRole = (typeof RULE_ROLES)[number];

export function isRuleRole(value: unknown): value is RuleRole {
  return (
    typeof value === "string" && (RULE_ROLES as readonly string[]).includes(value)
  );
}

/** 기본 최소 레벨 — DB app.assignment_role_default_min과 반드시 동일 유지 */
export const ASSIGNMENT_ROLE_MIN_DEFAULTS: Record<RuleRole, UserGrade> = {
  pl: "team_lead",
  pm: "deputy",
  deputy_pm: "senior",
  member: "staff",
};

export type RoleMinGrades = Record<RuleRole, UserGrade>;

/** 배정 역할의 유효 최소 레벨 — 겸임(pl_pm)은 PL·PM 중 높은 쪽 */
export function resolveRoleMinGrade(
  role: AssignmentRole,
  mins: RoleMinGrades
): UserGrade {
  if (role === "pl") return mins.pl;
  if (role === "pm") return mins.pm;
  if (role === "pl_pm") {
    return gradeRank(mins.pl) >= gradeRank(mins.pm) ? mins.pl : mins.pm;
  }
  if (role === "deputy_pm") return mins.deputy_pm;
  return mins.member;
}

/**
 * 배정 대상의 레벨이 역할 최소 레벨에 못 미치면 안내 문구를 돌려준다.
 * 최소 레벨이 레벨 6(staff)이면 전 직원 통과 — 검사하지 않는다
 * (기존 '담당은 제한 없음' 동작 유지).
 */
export function roleMinGradeError(
  role: AssignmentRole,
  targetGrade: string | null,
  mins: RoleMinGrades
): string | null {
  const min = resolveRoleMinGrade(role, mins);
  if (min === "staff") return null;
  const grade: UserGrade | null = isUserGrade(targetGrade) ? targetGrade : null;
  if (gradeAtLeast(grade, min)) return null;
  return `${ASSIGNMENT_ROLE_LABELS[role]} 역할은 ${GRADE_LABELS[min]} 이상만 지정할 수 있습니다 (권한 규칙). 대상자의 권한 레벨을 조정하거나, 설정 > 임직원 설정에서 역할별 최소 레벨을 바꿀 수 있습니다.`;
}
