import { z } from "zod";

import { APPROVAL_TYPES } from "./constants";

/** 결재라인 한 줄 (수동 지정·전결규정 편집 공용) — 같은 순번 = 병렬 합의 */
export const lineStepSchema = z.object({
  stepOrder: z
    .string()
    .regex(/^\d{1,2}$/, "순번은 1~99 숫자로 입력하세요.")
    .refine((v) => parseInt(v, 10) >= 1, "순번은 1 이상이어야 합니다."),
  stepKind: z.enum(["approval", "agreement"]),
  approverUserId: z.string().uuid("결재자를 선택하세요."),
});
export type LineStepInput = z.infer<typeof lineStepSchema>;

/** 품의 상신 */
export const approvalSubmitSchema = z.object({
  title: z
    .string()
    .min(1, "제목을 입력하세요.")
    .max(200, "제목은 200자 이내로 입력하세요."),
  body: z.string().max(10000, "내용은 10000자 이내로 입력하세요.").optional(),
  approvalType: z.enum(APPROVAL_TYPES),
  amount: z
    .string()
    .regex(/^\d*$/, "금액은 숫자만 입력하세요 (원 단위).")
    .optional(),
  projectId: z.string().uuid().optional().or(z.literal("")),
  /** 전결규정 미적용 시 수동 결재라인 */
  manualSteps: z.array(lineStepSchema).optional(),
});
export type ApprovalSubmitInput = z.infer<typeof approvalSubmitSchema>;

/** 승인·반려 처리 */
export const approvalActSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().max(1000, "의견은 1000자 이내로 입력하세요.").optional(),
});
export type ApprovalActInput = z.infer<typeof approvalActSchema>;

/** 전결규정 생성·개정 */
export const ruleSaveSchema = z.object({
  /** 개정 대상 (없으면 신규) */
  baseRuleId: z.string().uuid().optional().or(z.literal("")),
  name: z
    .string()
    .min(1, "규정명을 입력하세요.")
    .max(100, "규정명은 100자 이내로 입력하세요."),
  approvalType: z.enum(APPROVAL_TYPES).optional().or(z.literal("")),
  minAmount: z.string().regex(/^\d*$/, "숫자만 입력하세요.").optional(),
  maxAmount: z.string().regex(/^\d*$/, "숫자만 입력하세요.").optional(),
  priority: z.string().regex(/^\d{1,3}$/, "0~999 숫자로 입력하세요."),
  steps: z.array(lineStepSchema).min(1, "결재라인을 1단계 이상 구성하세요."),
});
export type RuleSaveInput = z.infer<typeof ruleSaveSchema>;

/** 대결·위임 설정 */
export const delegationSchema = z
  .object({
    delegateUserId: z.string().uuid("대결자를 선택하세요."),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시작일을 입력하세요."),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "종료일을 입력하세요."),
    reason: z.string().max(200, "사유는 200자 이내로 입력하세요.").optional(),
  })
  .refine((v) => v.startsOn <= v.endsOn, {
    message: "종료일은 시작일 이후여야 합니다.",
    path: ["endsOn"],
  });
export type DelegationInput = z.infer<typeof delegationSchema>;
