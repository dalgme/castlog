import "server-only";

import { sendPasswordResetEmail } from "@/lib/auth/account-invite";
import { generateTempPassword } from "@/lib/admin/passwords";
import { createAdminClient } from "@/lib/supabase/admin";

import type { ResetEmailResult, TempPasswordResult } from "./password-support";

/**
 * 비밀번호 지원 — 관리자가 남의 비밀번호를 **정해 주지는 않는다.**
 *
 * 정해 주면 관리자가 그 사람으로 로그인할 수 있고, 그 비밀번호가 메신저를
 * 타고 돌아다닌다. 그래서 두 경로만 둔다:
 *  1) 재설정 메일 — 본인이 링크에서 직접 정한다. 관리자는 비밀번호를 모른다.
 *  2) 임시 비밀번호 — 메일이 안 되는 사람을 위한 예비 수단. 무작위로 만들어
 *     한 번만 보여 주고 저장하지 않으며, 다음 로그인에서 반드시 바꾸게 한다
 *     (app_metadata.must_change_password → 미들웨어가 /account/password로 보낸다).
 * 둘 다 감사로그에 남는다 — 누가 언제 누구 계정을 건드렸는지.
 *
 * 누가 누구에게 할 수 있는가(게이트)는 호출하는 액션이 정한다. 여기는 대상이
 * 확정된 뒤의 실행과 기록만 맡는다.
 */

export type PasswordSupportTarget = {
  id: string;
  email: string;
  tenantId: string;
};

export type PasswordSupportActor = {
  userId: string;
  role: "platform_admin" | "org_admin" | "manager";
};

/** 대상 계정의 auth 메타 — 플랫폼관리자 여부 판정과 클레임 보존에 쓴다 */
export async function loadAuthMeta(
  userId: string
): Promise<{ ok: true; appMetadata: Record<string, unknown>; isPlatformAdmin: boolean } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  if (!data?.user) {
    return { ok: false, error: "로그인 계정이 없습니다 — 시스템 결함입니다. 개발팀에 알려 주세요." };
  }
  const appMetadata = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  return { ok: true, appMetadata, isPlatformAdmin: appMetadata.role === "platform_admin" };
}

/** 임시 비밀번호 발급 — 1회 표시, 다음 로그인에서 강제 변경 */
export async function applyTempPassword(
  target: PasswordSupportTarget,
  appMetadata: Record<string, unknown>,
  actor: PasswordSupportActor
): Promise<TempPasswordResult> {
  const admin = createAdminClient();
  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(target.id, {
    password: tempPassword,
    // tenant_id·grade 등 기존 클레임은 그대로 — 플래그만 켠다
    app_metadata: { ...appMetadata, must_change_password: true },
  });
  if (error) {
    return {
      ok: false,
      error: "비밀번호 변경에 실패했습니다 — 잠시 후 다시 시도하고, 반복되면 개발팀에 알려 주세요.",
    };
  }

  await admin.from("audit_logs").insert({
    tenant_id: target.tenantId,
    actor_auth_user_id: actor.userId,
    actor_role: actor.role,
    action: "account.temp_password_issued",
    resource_type: "auth_user",
    resource_id: target.id,
    after_data: { email: target.email, must_change_password: true },
  });

  return { ok: true, tempPassword, email: target.email };
}

/** 비밀번호 재설정 메일 — 본인이 링크에서 직접 정한다 */
export async function applyResetEmail(
  target: PasswordSupportTarget,
  actor: PasswordSupportActor
): Promise<ResetEmailResult> {
  const sent = await sendPasswordResetEmail(target.email);

  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    tenant_id: target.tenantId,
    actor_auth_user_id: actor.userId,
    actor_role: actor.role,
    action: sent.ok ? "account.reset_email_sent" : "account.reset_email_failed",
    resource_type: "auth_user",
    resource_id: target.id,
    after_data: { email: target.email, error: sent.ok ? null : sent.error },
  });

  if (!sent.ok) {
    return {
      ok: false,
      error: `메일을 보내지 못했습니다 (${sent.error}) — 임시 비밀번호 발급으로 대신하세요.`,
    };
  }
  return { ok: true, email: target.email };
}
