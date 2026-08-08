import { z } from "zod";

/** 문의 유형 — 무료 체험 신청 / 도입 상담 */
export const INQUIRY_TYPES = ["trial", "consult"] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];

export const INQUIRY_TYPE_LABELS: Record<InquiryType, string> = {
  trial: "무료 체험 신청",
  consult: "도입 상담 문의",
};

/**
 * 도입 문의·무료 체험 신청 폼 스키마 (공개 페이지 /contact).
 * 결제·회원가입 없음 — 신청 접수 후 플랫폼관리자가 후속 연락.
 */
export const inquirySchema = z.object({
  inquiryType: z.enum(INQUIRY_TYPES),
  companyName: z
    .string()
    .trim()
    .min(1, "회사·기관명을 입력하세요.")
    .max(100, "100자 이내로 입력하세요."),
  contactName: z
    .string()
    .trim()
    .min(1, "담당자명을 입력하세요.")
    .max(50, "50자 이내로 입력하세요."),
  email: z
    .string()
    .trim()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다.")
    .max(200),
  phone: z
    .string()
    .trim()
    .max(30, "30자 이내로 입력하세요.")
    .optional()
    .or(z.literal("")),
  message: z
    .string()
    .trim()
    .max(2000, "2000자 이내로 입력하세요.")
    .optional()
    .or(z.literal("")),
  /** 유입 위치(랜딩 버튼 식별용) — 사용자 입력 아님 */
  source: z.string().trim().max(50).optional(),
});

export type InquiryInput = z.infer<typeof inquirySchema>;
