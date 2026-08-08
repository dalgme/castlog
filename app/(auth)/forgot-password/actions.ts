"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/auth/schemas";

export type ForgotPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * 비밀번호 재설정 메일 발송 (기업회원 — 이메일 계정).
 * 계정 존재 여부를 노출하지 않기 위해 항상 성공으로 응답한다.
 * 재설정 링크는 /auth/callback 에서 세션 교환 후 /reset-password 로 착지한다.
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    return {
      ok: false,
      error: "서버 설정(base URL)이 완료되지 않았습니다. 관리자에게 문의하세요.",
    };
  }

  const supabase = createClient();
  // 오류가 나더라도(존재하지 않는 계정 등) 사용자에게는 동일하게 응답한다.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
  });

  return { ok: true };
}
