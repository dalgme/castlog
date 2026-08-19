import { z } from "zod";

import { validateTenantSlug } from "@/lib/routing/slug";
import { MODULE_KEYS } from "@/lib/modules/modules";
import { USER_GRADES } from "@/lib/auth/grades";
import { ADMIN_SCOPES } from "@/lib/auth/admin-scope-keys";

/** 테넌트 생성 (플랫폼관리자 — 설계문서 7.1, 모듈 조합 선택 포함 CLAUDE.md 1-2) */
export const tenantCreateSchema = z.object({
  slug: z
    .string()
    .min(1, "슬러그를 입력하세요.")
    .refine(
      (value) => validateTenantSlug(value).ok,
      "영문 소문자·숫자·하이픈 2~40자, 예약어 제외 (예: nextlab)"
    ),
  name: z
    .string()
    .min(1, "기업명을 입력하세요.")
    .max(100, "기업명은 100자 이내로 입력하세요."),
  planName: z.string().max(50, "50자 이내로 입력하세요.").optional(),
  modules: z.object({
    experts: z.boolean(),
    approvals: z.boolean(),
    operations: z.boolean(),
  }),
  orgAdminName: z
    .string()
    .min(1, "총괄관리자 이름을 입력하세요.")
    .max(50, "이름은 50자 이내로 입력하세요."),
  orgAdminEmail: z
    .string()
    .min(1, "총괄관리자 이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
});
export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;

/** 모듈 조합 변경 */
export const tenantModulesSchema = z.object({
  tenantId: z.string().uuid(),
  modules: z.object({
    experts: z.boolean(),
    approvals: z.boolean(),
    operations: z.boolean(),
  }),
});
export type TenantModulesInput = z.infer<typeof tenantModulesSchema>;

/** 직원 계정 생성 — 권한단계 6단계 (기획 확정) */
export const staffCreateSchema = z.object({
  name: z
    .string()
    .min(1, "이름을 입력하세요.")
    .max(50, "이름은 50자 이내로 입력하세요."),
  email: z
    .string()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
  grade: z.enum(USER_GRADES, {
    errorMap: () => ({ message: "권한단계를 선택하세요." }),
  }),
  // 업무 연락·본인확인에 쓴다. users.phone 컬럼은 처음부터 있었는데 폼에만 없었다.
  phone: z.string().trim().max(30, "30자 이내로 입력하세요.").optional().or(z.literal("")),
  department: z.string().max(50, "50자 이내로 입력하세요.").optional(),
  positionId: z.string().uuid().optional().or(z.literal("")),
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

/**
 * 직원 정보 수정 — 권한단계(grade)는 여기 없다.
 * 등급 변경은 별도 화면·별도 액션이다. 정보 수정과 권한 조정을 한 폼에 섞으면
 * 부서 오타를 고치다가 등급을 잘못 건드리는 일이 생긴다.
 */
export const staffProfileSchema = z.object({
  userId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "이름을 입력하세요.")
    .max(50, "이름은 50자 이내로 입력하세요."),
  email: z
    .string()
    .trim()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
  phone: z
    .string()
    .trim()
    .max(30, "30자 이내로 입력하세요.")
    .optional()
    .or(z.literal("")),
  department: z
    .string()
    .trim()
    .max(50, "50자 이내로 입력하세요.")
    .optional()
    .or(z.literal("")),
  positionId: z.string().uuid().optional().or(z.literal("")),
});
export type StaffProfileInput = z.infer<typeof staffProfileSchema>;

/** 권한단계 변경 */
export const staffGradeSchema = z.object({
  userId: z.string().uuid(),
  grade: z.enum(USER_GRADES, {
    errorMap: () => ({ message: "권한단계를 선택하세요." }),
  }),
});
export type StaffGradeInput = z.infer<typeof staffGradeSchema>;

/** 관리권한 위임 부여 (CEO 전용) */
export const adminGrantSchema = z.object({
  userId: z.string().uuid(),
  scopes: z.array(z.enum(ADMIN_SCOPES)).min(1, "위임할 기능을 선택하세요."),
  note: z.string().max(200, "200자 이내로 입력하세요.").optional(),
});
export type AdminGrantInput = z.infer<typeof adminGrantSchema>;

/** 직급 생성 */
export const positionCreateSchema = z.object({
  name: z
    .string()
    .min(1, "직급명을 입력하세요.")
    .max(30, "직급명은 30자 이내로 입력하세요."),
});
export type PositionCreateInput = z.infer<typeof positionCreateSchema>;

/** MODULE_KEYS 재노출 (다이얼로그 렌더 순서 고정용) */
export { MODULE_KEYS };
