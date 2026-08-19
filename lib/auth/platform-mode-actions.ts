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
 */

/** 기업 모드 → 관리모드 */
export async function enterPlatformAdminMode(): Promise<void> {
  if (!hasSupabaseEnv()) redirect("/login");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!canEnterPlatformMode(user)) {
    // 명단에 없으면 조용히 원래 자리로 — 여기서 이유를 설명할 대상이 아니다
    redirect("/");
  }

  const priorRole = roleFromUser(user);
  const priorTenantId = tenantIdFromUser(user);
  const priorSlug = user.app_metadata?.tenant_slug;

  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(user.id, {
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

  await admin.from("audit_logs").insert({
    tenant_id: priorTenantId,
    actor_auth_user_id: user.id,
    actor_role: priorRole,
    action: "platform_mode.enter",
    resource_type: "auth_user",
    resource_id: user.id,
  });

  await supabase.auth.refreshSession();
  redirect("/platform-admin");
}

/** 관리모드 → 원래 기업 모드 */
export async function exitPlatformAdminMode(): Promise<void> {
  if (!hasSupabaseEnv()) redirect("/login");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prior = readPriorContext(user);
  if (!prior) {
    // 보관된 자리가 없으면 되돌릴 곳이 없다 — 관리모드에 그대로 둔다
    redirect("/platform-admin");
  }

  const admin = createAdminClient();
  const next = { ...user.app_metadata };
  delete next.platform_mode_prior;

  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...next,
      role: prior.role,
      tenant_id: prior.tenant_id,
      tenant_slug: prior.tenant_slug,
    },
  });

  await admin.from("audit_logs").insert({
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
