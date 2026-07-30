import "server-only";

import { randomBytes } from "crypto";

/**
 * 임시 비밀번호 생성 — 계정 생성 시 1회만 화면에 표시하고 어디에도 저장하지 않는다.
 * (초대 이메일 발송은 단계 14 발송 인프라 이후 — Resend SMTP)
 */
export function generateTempPassword(): string {
  // base64url 12자 + 특수문자 — Supabase 기본 비밀번호 정책(6자 이상) 충족
  return `${randomBytes(9).toString("base64url")}!2`;
}
