import { z } from "zod";

import { normalizeKrMobileE164 } from "./phone";

/** 직원 이메일 로그인 (설계문서 3.1 — 직원 계정은 이메일 기반) */
export const staffLoginSchema = z.object({
  email: z
    .string()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
  password: z.string().min(1, "비밀번호를 입력하세요."),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

/** 전문가 휴대폰 OTP 요청 (설계문서 3.2 — 전문가 계정은 휴대폰 인증 기반) */
export const expertPhoneSchema = z.object({
  phone: z
    .string()
    .min(1, "휴대폰 번호를 입력하세요.")
    .refine(
      (value) => normalizeKrMobileE164(value) !== null,
      "올바른 휴대폰 번호가 아닙니다 (예: 010-1234-5678)."
    ),
});
export type ExpertPhoneInput = z.infer<typeof expertPhoneSchema>;

/** 전문가 OTP 검증 */
export const expertOtpSchema = expertPhoneSchema.extend({
  token: z.string().regex(/^\d{6}$/, "인증번호 6자리를 입력하세요."),
});
export type ExpertOtpInput = z.infer<typeof expertOtpSchema>;

/**
 * 로그인 후 이동 경로 검증 — 오픈 리다이렉트 방지.
 * 내부 상대 경로만 허용한다 (`//host`·프로토콜 포함 값 거부).
 */
export function sanitizeNextPath(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return null;
  }
  return next;
}
