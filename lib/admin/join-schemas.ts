import { z } from "zod";

/**
 * 임직원 셀프 가입 신청 (공개 페이지 /{tenant}/join)
 *
 * 신청자는 **권한단계(grade)를 고르지 않는다.** 자기 등급을 스스로 정하면 그건
 * 권한 상승 경로다. 등급은 승인하는 대표(또는 staff 위임자)가 지정한다.
 */
export const staffJoinRequestSchema = z.object({
  tenantSlug: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "이름을 입력하세요.")
    .max(50, "50자 이내로 입력하세요."),
  email: z
    .string()
    .trim()
    .min(1, "회사 이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다.")
    .max(200),
  phone: z
    .string()
    .trim()
    .min(1, "휴대전화번호를 입력하세요.")
    .max(30, "30자 이내로 입력하세요."),
  department: z.string().trim().max(50, "50자 이내로 입력하세요.").optional().or(z.literal("")),
  note: z.string().trim().max(500, "500자 이내로 입력하세요.").optional().or(z.literal("")),
  termsConsent: z.literal(true, {
    errorMap: () => ({ message: "이용약관에 동의해야 신청할 수 있습니다." }),
  }),
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: "개인정보 수집·이용에 동의해야 신청할 수 있습니다." }),
  }),
});
export type StaffJoinRequestInput = z.infer<typeof staffJoinRequestSchema>;

/** 가입 신청 승인 — 등급·직급은 승인자가 정한다. */
export const staffJoinApproveSchema = z.object({
  requestId: z.string().uuid(),
  grade: z.string().min(1, "권한단계를 선택하세요."),
  positionId: z.string().uuid().optional().or(z.literal("")),
  note: z.string().max(200).optional(),
});
export type StaffJoinApproveInput = z.infer<typeof staffJoinApproveSchema>;
