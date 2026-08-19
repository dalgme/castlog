"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

import { canEnterPlatformMode, readPriorContext } from "./platform-mode";

/**
 * 캐스트로그 관리모드 전환 (넥스트랩 운영자 전용).
 *
 * 권한 승격이므로 판정 근거는 **환경변수 명단 + 서버 세션의 이메일** 둘뿐이다.
 * 클라이언트가 보낸 값은 아무것도 쓰지 않는다. 두 동작 모두 감사로그를 남긴다 —
 * 테넌트 경계를 넘는 행위는 흔적이 있어야 한다.
 *
 * **실패는 조용히 넘기지 않는다.** 처음에는 거부 시 홈으로 되돌려보냈는데,
 * 그러면 사용자는 '눌렀는데 아무 일도 안 일어난다'만 겪고 무엇이 잘못됐는지
 * 알 수 없다. 명단에 없는 것인지, 환경변수를 못 읽는 것인지, 저장이 실패한
 * 것인지가 구분되어야 고칠 수 있다.
 */

export type PlatformModeResult = { ok: true } | { ok: false; error: string };

/** 기업 모드 → 관리모드 */
export async function enterPlatformAdminMode(): Promise<PlatformModeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  if (!canEnterPlatformMode(user)) {
    return {
      ok: false,
      error:
        `이 계정(${user.email ?? "이메일 미확인"})은 관리자 모드 명단에 없습니다. ` +
        "배포 환경변수 PLATFORM_ADMIN_EMAILS에 이 이메일이 있는지, 값을 바꾼 뒤 " +
        "재배포(Redeploy)를 했는지 확인하세요.",
    };
  }

  const priorRole = roleFromUser(user);
  const priorTenantId = tenantIdFromUser(user);
  const priorSlug = user.app_metadata?.tenant_slug;

  // 이미 관리모드면 굳이 다시 쓰지 않는다
  if (priorRole === "platform_admin") redirect("/platform-admin");

  const admin = createAdminClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      role: "platform_admin",
      // 원래 자리를 보관한다 — 나갈 때 되돌릴 근거
      platform_mode_prior: {
        role: priorRole,
        tenant_id: priorTenantId,
        tenant_slug: typeof priorSlug === "string" ? priorSlug : null,
      },
    },
  });
  if (updateError) {
    return {
      ok: false,
      error: `권한 전환에 실패했습니다: ${updateError.message}`,
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: priorTenantId,
    actor_auth_user_id: user.id,
    actor_role: priorRole,
    action: "platform_mode.enter",
    resource_type: "auth_user",
    resource_id: user.id,
  });

  // 세션 갱신은 되면 좋고, 안 돼도 막히지 않는다 — 인증 가드가 getUser()로
  // 인증 서버의 사용자 레코드를 직접 읽으므로 갱신된 역할이 곧바로 반영된다.
  await supabase.auth.refreshSession();
  redirect("/platform-admin");
}

/** 관리모드 → 원래 기업 모드 */
export async function exitPlatformAdminMode(): Promise<PlatformModeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const prior = readPriorContext(user);
  if (!prior) {
    return {
      ok: false,
      error:
        "돌아갈 기업 계정 정보가 없습니다. 이 계정은 관리자 전용 계정이거나, " +
        "전환 기록이 지워졌습니다.",
    };
  }

  const admin = createAdminClient();
  const next = { ...user.app_metadata };
  delete next.platform_mode_prior;

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...next,
      role: prior.role,
      tenant_id: prior.tenant_id,
      tenant_slug: prior.tenant_slug,
    },
  });
  if (updateError) {
    return { ok: false, error: `복귀에 실패했습니다: ${updateError.message}` };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: prior.tenant_id,
    actor_auth_user_id: user.id,
    actor_role: "platform_admin",
    action: "platform_mode.exit",
    resource_type: "auth_user",
    resource_id: user.id,
  });

  await supabase.auth.refreshSession();
  redirect(prior.tenant_slug ? `/${prior.tenant_slug}/dashboard` : "/");
}
