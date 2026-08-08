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

/** 비밀번호 재설정 요청 — 이메일 입력 (기업회원) */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "이메일을 입력하세요.")
    .email("올바른 이메일 형식이 아닙니다."),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** 새 비밀번호 설정 — 재설정 링크 착지 후 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "비밀번호는 8자 이상이어야 합니다.")
      .max(72, "비밀번호는 72자 이내여야 합니다."),
    confirm: z.string().min(1, "비밀번호 확인을 입력하세요."),
  })
  .refine((d) => d.password === d.confirm, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["confirm"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
  // 역슬래시는 브라우저가 '/'로 정규화 → '/\evil.com' 우회를 차단한다.
  // 제어문자(공백 미만)·역슬래시가 있으면 거부.
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code < 0x20 || code === 0x5c) return null;
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return null;
  }
  return next;
}
