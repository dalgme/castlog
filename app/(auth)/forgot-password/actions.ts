"use server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { sendPasswordResetEmail } from "@/lib/auth/account-invite";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/auth/schemas";

export type ForgotPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * 비밀번호 재설정 메일 발송 (기업회원 — 이메일 계정).
 * 계정 존재 여부를 노출하지 않기 위해 항상 성공으로 응답한다.
 * 재설정 링크는 /auth/confirm 에서 서버가 확인한 뒤 /reset-password 로 착지한다.
 * 계정 발급 안내 메일과 **같은 경로**를 쓴다 — 서로 다른 방식으로 나가면 한쪽만
 * 조용히 깨져도 알아채지 못한다(실제로 그런 식으로 깨졌다).
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput
): Promise<ForgotPasswordResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error: "서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요.",
    };
  }

  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  // 오류가 나더라도(존재하지 않는 계정 등) 사용자에게는 동일하게 응답한다.
  // 여기서 실패를 그대로 돌려주면 "이 이메일이 가입되어 있는가"를 알려 주는
  // 조회 창구가 된다.
  await sendPasswordResetEmail(parsed.data.email);

  return { ok: true };
}
