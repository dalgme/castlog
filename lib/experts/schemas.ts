import { z } from "zod";

import { normalizeKrMobileE164 } from "@/lib/auth/phone";

/** 전문가 등록 요청 생성 (기업 측 — 이름·휴대폰은 선택 프리필) */
export const inviteCreateSchema = z.object({
  name: z.string().max(50, "이름은 50자 이내로 입력하세요.").optional(),
  phone: z
    .string()
    .optional()
    .refine(
      (value) => !value || normalizeKrMobileE164(value) !== null,
      "올바른 휴대폰 번호가 아닙니다 (예: 010-1234-5678)."
    ),
});
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

/** 전문가 프로필 (등록 폼·포털 수정 공용) */
export const expertProfileSchema = z.object({
  name: z
    .string()
    .min(1, "이름을 입력하세요.")
    .max(50, "이름은 50자 이내로 입력하세요."),
  email: z
    .string()
    .email("올바른 이메일 형식이 아닙니다.")
    .optional()
    .or(z.literal("")),
  specialty: z.string().max(100, "100자 이내로 입력하세요.").optional(),
  region: z.string().max(50, "50자 이내로 입력하세요.").optional(),
  careerYears: z
    .string()
    .regex(/^\d{0,2}$/, "경력은 0~99 사이 숫자로 입력하세요.")
    .optional(),
  bio: z.string().max(2000, "소개는 2000자 이내로 입력하세요.").optional(),
});
export type ExpertProfileInput = z.infer<typeof expertProfileSchema>;

/** 등록 시 필수 동의 — 항목별 개별 기록 (설계문서 14.6, 하나로 묶지 않는다) */
export const joinConsentSchema = z.object({
  termsOfService: z.literal(true, {
    errorMap: () => ({ message: "이용약관 동의가 필요합니다." }),
  }),
  privacyCollection: z.literal(true, {
    errorMap: () => ({ message: "개인정보 수집·이용 동의가 필요합니다." }),
  }),
});
export type JoinConsentInput = z.infer<typeof joinConsentSchema>;

/** 등록 완료 제출 = 프로필 + 필수 동의 */
export const joinRegistrationSchema = expertProfileSchema.merge(joinConsentSchema);
export type JoinRegistrationInput = z.infer<typeof joinRegistrationSchema>;

/** 현재 약관 버전 — 약관 개정 시 갱신 */
export const CURRENT_TERMS_VERSION = "v1.0";

/**
 * 단계 27: 전문가 프로젝트 종료 평가 (대표 피드백 ①)
 * 점수 10점 만점 필수 · 사유 선택. 테넌트 격리·전문가 비공개.
 */
export const expertEvaluationSchema = z.object({
  projectId: z.string().uuid("프로젝트를 확인하세요."),
  expertId: z.string().uuid("전문가를 확인하세요."),
  engagementId: z.string().uuid().optional(),
  score: z
    .number({ invalid_type_error: "평가 점수를 선택하세요." })
    .int("점수는 1~10 사이 정수입니다.")
    .min(1, "평가 점수를 선택하세요.")
    .max(10, "점수는 10점 만점입니다."),
  reason: z.string().max(1000, "평가 사유는 1000자 이내로 입력하세요.").optional(),
});
export type ExpertEvaluationInput = z.infer<typeof expertEvaluationSchema>;
