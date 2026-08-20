"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/auth/schemas";

export type ResetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * 새 비밀번호 설정 — 재설정 링크(/auth/confirm)가 심은 세션에서만 동작.
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

  /**
   * 강제 변경 플래그 해제 — 계정 발급 직후 메일 링크로 온 사람이 걸린다.
   *
   * 새 계정에는 must_change_password가 걸려 있다(임시 비밀번호 제거 목적).
   * 그런데 이 화면에서 비밀번호를 정한 사람은 이메일 소유를 증명하고 **본인이
   * 직접** 비밀번호를 만들었다 — 플래그의 목적이 이미 달성됐다. 여기서 해제하지
   * 않으면 방금 정한 비밀번호가 '임시' 취급되어, 로그인하자마자 미들웨어가
   * 비밀번호를 또 바꾸라는 화면으로 보낸다. 첫인상이 고장으로 시작된다.
   */
  if (user.app_metadata?.must_change_password === true) {
    const admin = createAdminClient();
    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: false },
    });
    // 해제 실패는 로그인 후 강제 변경 화면이 한 번 더 뜨는 정도다 —
    // 비밀번호 자체는 이미 바뀌었으므로 성공으로 처리한다.
    if (!metaError) {
      await supabase.from("audit_logs").insert({
        tenant_id: tenantIdFromUser(user),
        actor_auth_user_id: user.id,
        actor_role: roleFromUser(user),
        action: "user.password_set_via_reset",
        resource_type: "user",
        resource_id: user.id,
      });
    }
  }

  return { ok: true };
}
