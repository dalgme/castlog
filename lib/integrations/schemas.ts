import { z } from "zod";

/** 섭외 요청 생성 (기업 측 — experts 모듈, 프로젝트 연결은 operations 활성 시) */
export const engagementCreateSchema = z
  .object({
    expertId: z.string().uuid("전문가를 선택하세요."),
    projectId: z.string().uuid().optional().or(z.literal("")),
    roleDescription: z
      .string()
      .min(1, "요청 역할을 입력하세요 (예: 멘토, 심사위원).")
      .max(100, "역할은 100자 이내로 입력하세요."),
    feeAmount: z
      .string()
      .regex(/^\d*$/, "의뢰비용은 숫자만 입력하세요 (원 단위).")
      .optional(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    message: z.string().max(2000, "요청 내용은 2000자 이내로 입력하세요.").optional(),
  })
  .refine(
    (v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn,
    { message: "종료일은 시작일 이후여야 합니다.", path: ["endsOn"] }
  );
export type EngagementCreateInput = z.infer<typeof engagementCreateSchema>;

/** 섭외 응답 (공개 링크·포털 공용) */
export const engagementRespondSchema = z.object({
  decision: z.enum(["accepted", "declined"]),
  responseNote: z.string().max(1000, "의견은 1000자 이내로 입력하세요.").optional(),
});
export type EngagementRespondInput = z.infer<typeof engagementRespondSchema>;
