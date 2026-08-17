import { z } from "zod";

import { STEP_STATUSES } from "./steps";

/** 프로젝트 생성 (operations 모듈) */
export const projectCreateSchema = z.object({
  name: z
    .string()
    .min(1, "프로젝트명을 입력하세요.")
    .max(100, "프로젝트명은 100자 이내로 입력하세요."),
  businessYear: z
    .string()
    .regex(/^\d{4}$/, "사업연도는 4자리 숫자로 입력하세요 (예: 2026)."),
  clientName: z.string().max(100, "100자 이내로 입력하세요.").optional(),
  code: z.string().max(30, "관리 코드는 30자 이내로 입력하세요.").optional(),
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.")
    .optional()
    .or(z.literal("")),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.")
    .optional()
    .or(z.literal("")),
  budgetAmount: z
    .string()
    .regex(/^\d*$/, "예산은 숫자만 입력하세요 (원 단위).")
    .optional(),
  description: z.string().max(2000, "설명은 2000자 이내로 입력하세요.").optional(),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

/** 스텝 상태 변경 */
export const stepStatusSchema = z.object({
  stepId: z.string().uuid(),
  status: z.enum(STEP_STATUSES),
});
export type StepStatusInput = z.infer<typeof stepStatusSchema>;
