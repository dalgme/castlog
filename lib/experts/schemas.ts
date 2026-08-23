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

/** 거주지 광역자치단체 선택지 (기획 확정 2026-08-22) */
export const REGION_SIDO_OPTIONS = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

/** 최종학위 선택지 (기획 확정 2026-08-22) */
export const DEGREE_LEVEL_OPTIONS = [
  "학사",
  "석사 수료",
  "석사",
  "박사 수료",
  "박사",
  "기타",
] as const;

/** 저장된 region 문자열을 광역/세부로 분해 (프로필 폼 프리필용) */
export function splitRegion(region: string | null): {
  sido: string;
  detail: string;
} {
  if (!region) return { sido: "", detail: "" };
  const found = REGION_SIDO_OPTIONS.find((s) => region.startsWith(s));
  if (!found) return { sido: "", detail: region };
  return { sido: found, detail: region.slice(found.length).trim() };
}

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
  organization: z.string().max(100, "소속은 100자 이내로 입력하세요.").optional(),
  jobTitle: z.string().max(100, "직위는 100자 이내로 입력하세요.").optional(),
  region: z.string().max(150, "150자 이내로 입력하세요.").optional(),
  /** 거주지 — 광역 선택 + 세부 주소 (서버가 region으로 합쳐 저장) */
  regionSido: z
    .string()
    .optional()
    .refine(
      (v) => !v || (REGION_SIDO_OPTIONS as readonly string[]).includes(v),
      "광역자치단체를 선택하세요."
    ),
  regionDetail: z.string().max(120, "세부 주소는 120자 이내로 입력하세요.").optional(),
  careerYears: z
    .string()
    .regex(/^\d{0,2}$/, "경력은 0~99 사이 숫자로 입력하세요.")
    .optional(),
  bio: z.string().max(2000, "소개는 2000자 이내로 입력하세요.").optional(),
  degreeCertifications: z
    .string()
    .max(500, "자격증은 500자 이내로 입력하세요.")
    .optional(),
  degreeLevel: z
    .string()
    .optional()
    .refine(
      (v) => !v || (DEGREE_LEVEL_OPTIONS as readonly string[]).includes(v),
      "최종학위를 선택하세요."
    ),
  degreeMajor: z.string().max(100, "전공명은 100자 이내로 입력하세요.").optional(),
  // 보조 연락처: 휴대폰뿐 아니라 일반번호(02·031·070 등)도 허용
  secondaryPhone: z
    .string()
    .optional()
    .refine(
      (value) => !value || /^0\d{7,10}$/.test(value.replace(/\D/g, "")),
      "올바른 연락처가 아닙니다 (예: 010-1234-5678, 02-123-4567)."
    ),
});
export type ExpertProfileInput = z.infer<typeof expertProfileSchema>;

/**
 * 계좌(통장) 정보 — 전문가 본인 직접입력.
 * 계좌번호는 평문 저장 금지: AES-256-GCM(lib/crypto/secrets)로 암호화하고
 * 표시용 마지막 4자리(account_last4)만 별도 보관한다.
 */
export const bankAccountSchema = z.object({
  bankName: z.string().max(30, "30자 이내로 입력하세요.").optional().or(z.literal("")),
  accountHolder: z
    .string()
    .max(30, "30자 이내로 입력하세요.")
    .optional()
    .or(z.literal("")),
  accountNumber: z
    .string()
    .regex(/^[0-9-]{0,30}$/, "계좌번호는 숫자와 - 기호만 입력하세요.")
    .optional()
    .or(z.literal("")),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

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
