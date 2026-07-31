import { z } from "zod";

/** 일괄 지급 건 생성 (기획 확정 — 프로젝트 귀속 전문가 리스트 일괄 품의) */
export const batchCreateSchema = z.object({
  projectId: z.string().uuid().optional().or(z.literal("")),
  title: z
    .string()
    .min(1, "지급 건 제목을 입력하세요.")
    .max(120, "제목은 120자 이내로 입력하세요."),
  engagementIds: z
    .array(z.string().uuid())
    .min(1, "지급 대상을 1건 이상 선택하세요."),
});
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;

/** 전문가 소득유형 설정 (전문가 본인 — 포털) */
export const taxTypeSchema = z.object({
  paymentType: z.enum(["business_income", "other_income", "business"], {
    errorMap: () => ({ message: "소득유형을 선택하세요." }),
  }),
  businessRegistrationNumber: z
    .string()
    .regex(/^[\d-]*$/, "사업자등록번호는 숫자와 하이픈만 입력하세요.")
    .max(12, "사업자등록번호 형식을 확인하세요.")
    .optional(),
});
export type TaxTypeInput = z.infer<typeof taxTypeSchema>;
