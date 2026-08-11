"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { postLoginPath } from "@/lib/auth/session";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/auth/schemas";

export type ChangePasswordResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/**
 * 단계 30: 최초 로그인 비밀번호 강제 변경.
 * 관리자가 발급한 임시 비밀번호(app_metadata.must_change_password) 사용자가
 * 새 비밀번호를 설정하면 플래그를 해제한다. 해제는 service_role(admin)로만 가능.
 */
export async function changeInitialPassword(
  input: ResetPasswordInput
): Promise<ChangePasswordResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 인증 설정이 완료되지 않았습니다." };
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
    return { ok: false, error: "세션이 만료되었습니다. 다시 로그인해 주세요." };
  }

  const { error: pwError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (pwError) {
    return {
      ok: false,
      error:
        "비밀번호 변경에 실패했습니다. 임시 비밀번호와 다른 값을 사용해 주세요.",
    };
  }

  // 강제 변경 플래그 해제 — 기존 app_metadata 보존(tenant_id·role 등)
  const admin = createAdminClient();
  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });
  if (metaError) {
    return {
      ok: false,
      error: "설정 갱신에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "user.password_change_initial",
    resource_type: "user",
    resource_id: user.id,
  });

  return { ok: true, redirectTo: postLoginPath(user) };
}
