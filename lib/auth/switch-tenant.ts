"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import type { SwitchActiveTenantResult } from "./tenant";

/**
 * 활성 테넌트 전환 (설계문서 3.6 — 전문가처럼 여러 테넌트에 연결된 계정용)
 *
 * 서버가 expert_tenant_links의 활성 연결을 검증한 뒤에만 JWT app_metadata의
 * tenant_id·tenant_slug를 갱신한다. 클라이언트가 보낸 tenant_id를 그대로
 * 신뢰하지 않는다 — 반드시 연결 검증을 통과해야 한다.
 */
export async function switchActiveTenant(
  targetTenantId: string
): Promise<SwitchActiveTenantResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "unauthorized" };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "unauthorized" };
  }

  const admin = createAdminClient();

  // 0) 기업 직원 역할 계정은 테넌트 전환 대상이 아니다.
  //    직원은 단일 테넌트 소속이며, 전환은 여러 기업에 연결되는 전문가 전용이다.
  const currentRole = user.app_metadata?.role;
  if (currentRole && currentRole !== "expert") {
    return { ok: false, error: "unauthorized" };
  }

  // 1) 요청 사용자가 전문가 계정인지
  const { data: expert } = await admin
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!expert) {
    return { ok: false, error: "unauthorized" };
  }

  // 2) 대상 테넌트와의 연결 존재·활성 여부
  const { data: link } = await admin
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", expert.id)
    .eq("tenant_id", targetTenantId)
    .maybeSingle();

  if (!link) {
    return { ok: false, error: "not_linked" };
  }
  if (link.status !== "active") {
    return { ok: false, error: "link_inactive" };
  }

  // 3) 검증 통과 — app_metadata 갱신 (기존 role 등은 보존)
  const { data: tenant } = await admin
    .from("tenants")
    .select("slug")
    .eq("id", targetTenantId)
    .maybeSingle();

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      role: "expert", // 전환 계정의 역할을 전문가로 명시 고정 (권한 승격 방지)
      tenant_id: targetTenantId,
      tenant_slug: tenant?.slug ?? null,
    },
  });

  if (updateError) {
    return { ok: false, error: "unauthorized" };
  }

  await supabase.auth.refreshSession();

  return { ok: true, tenantId: targetTenantId };
}
