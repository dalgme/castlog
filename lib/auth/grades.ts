/**
 * 권한 6단계 (기획 확정)
 *
 *   ceo(대표) > director(이사) > team_lead(팀장) > deputy(대리) > senior(주임) > staff(사원)
 *
 * 저장 위치는 users.grade, 권한 판정용 JWT 클레임은 app_metadata.grade.
 * 기존 users.role(org_admin/manager/staff)은 DB 트리거가 grade에서 파생시키는
 * **호환 계층**이다. 코드에서 role을 직접 바꾸지 않는다 — 항상 grade를 바꾼다.
 *
 * 두 축을 분리해서 쓴다:
 *  - 실행 권한(섭외요청·수락서 등): role 기반 (팀장까지 manager)
 *  - 열람 범위(전사 프로젝트):      canViewAllProjects (대표·이사만)
 *
 * 이 파일은 클라이언트 컴포넌트에서도 쓰므로 server-only를 붙이지 않는다.
 */

export const USER_GRADES = [
  "ceo",
  "director",
  "team_lead",
  "deputy",
  "senior",
  "staff",
] as const;

export type UserGrade = (typeof USER_GRADES)[number];

/** 화면 표기명 — 직급(positions)과 별개인 '권한단계' 이름이다. */
export const GRADE_LABELS: Record<UserGrade, string> = {
  ceo: "대표",
  director: "이사",
  team_lead: "팀장",
  deputy: "대리",
  senior: "주임",
  staff: "사원",
};

export const GRADE_DESCRIPTIONS: Record<UserGrade, string> = {
  ceo: "회사 총괄관리자 — 업무 전체 + 시스템 설정·관리",
  director: "전사 프로젝트 열람·배정, 섭외·결재 실행",
  team_lead: "배정 프로젝트 실행(섭외요청·수락서), 열람은 배정 범위",
  deputy: "배정 프로젝트 실무",
  senior: "배정 프로젝트 실무",
  staff: "배정 프로젝트 실무",
};

/** 높을수록 상위 권한 (DB의 app.grade_rank와 동일 기준) */
const GRADE_RANK: Record<UserGrade, number> = {
  ceo: 60,
  director: 50,
  team_lead: 40,
  deputy: 30,
  senior: 20,
  staff: 10,
};

export function isUserGrade(value: unknown): value is UserGrade {
  return (
    typeof value === "string" && (USER_GRADES as readonly string[]).includes(value)
  );
}

export function gradeRank(grade: UserGrade | null): number {
  return grade ? GRADE_RANK[grade] : 0;
}

export function gradeAtLeast(
  grade: UserGrade | null,
  minimum: UserGrade
): boolean {
  return gradeRank(grade) >= GRADE_RANK[minimum];
}

export function gradeLabel(grade: string | null | undefined): string {
  return isUserGrade(grade) ? GRADE_LABELS[grade] : "-";
}

/** grade → 기존 role 파생 (DB의 app.role_from_grade와 반드시 동일하게 유지) */
export function roleFromGrade(grade: UserGrade): "org_admin" | "manager" | "staff" {
  if (grade === "ceo") return "org_admin";
  if (grade === "director" || grade === "team_lead") return "manager";
  return "staff";
}

/** JWT 클레임에 grade가 아직 없는 기존 세션 대비 역산 (DB app.user_grade와 동일) */
export function gradeFromLegacyRole(role: string | null): UserGrade {
  if (role === "org_admin") return "ceo";
  if (role === "manager") return "director";
  return "staff";
}

/** 전사 프로젝트 열람 권한자 = 대표·이사 */
export function canViewAllProjects(grade: UserGrade | null): boolean {
  return gradeAtLeast(grade, "director");
}
