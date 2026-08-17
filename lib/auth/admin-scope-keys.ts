/**
 * 관리권한 위임 스코프 상수 (클라이언트 컴포넌트 공용).
 * 서버 가드(requireAdminScope 등)는 lib/auth/admin-scopes.ts 에 있다.
 */

export const ADMIN_SCOPES = ["settings", "staff", "sending", "audit"] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export const ADMIN_SCOPE_LABELS: Record<AdminScope, string> = {
  settings: "테넌트 설정·모듈",
  staff: "직원 계정·권한",
  sending: "발송 설정·템플릿",
  audit: "감사로그·사용량·백업",
};

export const ADMIN_SCOPE_DESCRIPTIONS: Record<AdminScope, string> = {
  settings: "회사 정보, 사용 모듈, 기본 운영 설정을 변경할 수 있습니다.",
  staff: "직원 계정 생성·권한단계 변경·비활성화를 할 수 있습니다.",
  sending: "SMS 공급자·발신번호·발송 템플릿을 관리할 수 있습니다.",
  audit: "감사로그 조회, 사용량 확인, 데이터 반출을 할 수 있습니다.",
};

export function isAdminScope(value: unknown): value is AdminScope {
  return (
    typeof value === "string" && (ADMIN_SCOPES as readonly string[]).includes(value)
  );
}

export type AdminScopeSet = Record<AdminScope, boolean>;
