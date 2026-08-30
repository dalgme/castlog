import { z } from "zod";

import { STEP_STATUSES } from "./steps";

/** 프로젝트 생성 (operations 모듈) */
export const projectCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "프로젝트명을 입력하세요.")
    .max(100, "프로젝트명은 100자 이내로 입력하세요."),
  businessYear: z
    .string()
    .regex(/^\d{4}$/, "사업연도는 4자리 숫자로 입력하세요 (예: 2026).")
    // DB CHECK(2000~2100)와 같은 범위 — 여기서 거르지 않으면 오타(1999·3026)가
    // DB 제약 위반 원문으로 사용자에게 노출된다
    .refine((v) => {
      const year = parseInt(v, 10);
      return year >= 2000 && year <= 2100;
    }, "사업연도는 2000~2100 사이여야 합니다."),
  clientName: z.string().max(100, "100자 이내로 입력하세요.").optional(),
  // 분야별 카테고리 — 대표가 설정한 목록에서 고른다(하드코딩 없음).
  // 카테고리를 아직 만들지 않은 테넌트도 프로젝트를 열 수 있어야 하므로 선택이다.
  categoryId: z.string().uuid().optional().or(z.literal("")),
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
    // 12자리(9,999억 원) 상한 — 무제한이면 2^53을 넘는 입력에서 정밀도가
    // 깨지거나 bigint 상한 초과로 DB 오류 원문이 노출된다
    .regex(/^\d{0,12}$/, "예산은 숫자만, 12자리(9,999억 원) 이내로 입력하세요.")
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
