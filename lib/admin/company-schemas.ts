import { z } from "zod";

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label}은(는) ${max}자 이내로 입력하세요.`).optional().or(z.literal(""));

/**
 * 기업 가입정보 + 개인정보 보호책임자 (개인정보보호법 §31)
 *
 * 사업자등록번호는 하이픈 유무를 가리지 않고 받되 숫자 10자리인지만 확인한다.
 * 형식을 과하게 강제하면 사업자등록번호가 없는 기관(고유번호증)이 막힌다.
 */
export const companyProfileSchema = z.object({
  businessRegistrationNumber: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^\d{3}-?\d{2}-?\d{5}$/.test(v),
      "사업자등록번호는 10자리 숫자로 입력하세요 (예: 123-45-67890)."
    )
    .optional()
    .or(z.literal("")),
  representativeName: optionalText(50, "대표자 성명"),
  address: optionalText(200, "사업장 주소"),
  contactPhone: optionalText(30, "대표 연락처"),
  industry: optionalText(100, "업종·업태"),
  privacyOfficerName: optionalText(50, "보호책임자 성명"),
  privacyOfficerEmail: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "올바른 이메일 형식이 아닙니다."
    )
    .optional()
    .or(z.literal("")),
  privacyOfficerPhone: optionalText(30, "보호책임자 연락처"),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
