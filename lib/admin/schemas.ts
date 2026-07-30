import { z } from "zod";

import { validateTenantSlug } from "@/lib/routing/slug";
import { MODULE_KEYS } from "@/lib/modules/modules";

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

/** 직원 계정 생성 (기업총괄관리자 — 설계문서 3.1) */
export const staffCreateSchema = z.object({
  name: z
    .string()
    .min(1, "이름을 입력하세요.")
    .max(50, "이름은 50자 이내로 입력하세요."),
  email: z
    .string()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
  role: z.enum(["org_admin", "manager", "staff"], {
    errorMap: () => ({ message: "역할을 선택하세요." }),
  }),
  department: z.string().max(50, "50자 이내로 입력하세요.").optional(),
  positionId: z.string().uuid().optional().or(z.literal("")),
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

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
