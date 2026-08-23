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

/**
 * 화면 표기명 — 직급(positions)과 별개인 '권한 레벨' 이름이다.
 * 기획 확정 2026-08-23: 직급 명칭(대표·이사·팀장…)과 똑같아 혼동을 일으켜
 * '레벨 1~6'으로 전환. 레벨 1이 최상위(보통 대표), 레벨 6이 기본(신규 입사).
 */
export const GRADE_LABELS: Record<UserGrade, string> = {
  ceo: "레벨 1",
  director: "레벨 2",
  team_lead: "레벨 3",
  deputy: "레벨 4",
  senior: "레벨 5",
  staff: "레벨 6",
};

/** 레벨 옆에 붙이는 짧은 꼬리표 — 선택지·목록에서 레벨 숫자만으로 부족할 때 */
export const GRADE_SHORT_TAGS: Record<UserGrade, string> = {
  ceo: "총괄 관리 (보통 대표)",
  director: "전사 열람·배정 (보통 임원)",
  team_lead: "프로젝트 총괄 실행 (PL 가능)",
  deputy: "섭외 실행 (PM·부PM 가능)",
  senior: "실무 입력",
  staff: "조회 전용 (기본)",
};

export const GRADE_DESCRIPTIONS: Record<UserGrade, string> = {
  ceo: "회사의 모든 기능 + 임직원 계정·전결규정·발송 등 시스템 설정·관리. 주민번호 조회 지정자 관리는 이 레벨만",
  director: "회사의 모든 프로젝트를 배정 없이 열람하고, 프로젝트에 담당자를 배정. 섭외·품의 실행",
  team_lead: "배정 프로젝트에서 전 기능 실행 + 레벨 4에 없는 4가지 — 프로젝트 개설, 보유자료 일괄 등록, 섭외 취소, 문자 자유 발송. PL은 이 레벨부터",
  deputy: "배정 프로젝트에서 섭외요청·수락서·안내문자·지급건 생성 등 실행. 개설·일괄 등록·섭외 취소·자유 문자는 불가. PM·부PM은 이 레벨부터",
  senior: "배정 프로젝트에서 실무 입력 — 세션 계획, 후보 지정, 예정가, 첨부. 발송·상신은 위 레벨이 실행",
  staff: "배정 프로젝트 조회와 일반 품의 상신만 (인턴·신규 입사 수준). 입력·실행 없음",
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
