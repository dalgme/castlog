"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  sanitizeNextPath,
  staffLoginSchema,
  type StaffLoginInput,
} from "@/lib/auth/schemas";
import { postLoginPath } from "@/lib/auth/session";

export type LoginActionError = { error: string };

/**
 * 직원 이메일 로그인 (설계문서 3.1)
 * 성공 시 next(내부 경로만 허용) 또는 역할별 기본 경로로 리다이렉트.
 */
export async function loginWithEmail(
  input: StaffLoginInput,
  next?: string | null
): Promise<LoginActionError> {
  if (!hasSupabaseEnv()) {
    return { error: "서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요." };
  }

  const parsed = staffLoginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // 존재하지 않는 계정과 비밀번호 오류를 구분해 알려주지 않는다 (계정 존재 노출 방지)
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  redirect(sanitizeNextPath(next) ?? postLoginPath(data.user));
}
