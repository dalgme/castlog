"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/auth/schemas";

export type ResetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * 새 비밀번호 설정 — 재설정 링크(/auth/callback)로 교환된 세션에서만 동작.
 * 세션이 없으면(링크 만료·직접 접근) 거부한다.
 */
export async function updatePassword(
  input: ResetPasswordInput
): Promise<ResetPasswordResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error: "서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요.",
    };
  }

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error:
        "재설정 세션이 만료되었습니다. 비밀번호 찾기를 다시 요청해 주세요.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return {
      ok: false,
      error: "비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return { ok: true };
}
