"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import {
  TENANT_EXTRA_FEATURES,
  parseExtraFeatures,
  type TenantExtraFeature,
} from "@/lib/features/tenant-features";
import type { Json } from "@/lib/supabase/database.types";

/**
 * 기업별 추가 기능 켜기/끄기 (관리모드 — 기획 2026-08-30 17번).
 * feature_flags는 여러 주체가 함께 쓰므로 setExpertsLite와 동일한
 * updated_at 낙관적 잠금으로 병합 경합을 막는다.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}

export async function setTenantExtraFeature(
  tenantId: string,
  feature: TenantExtraFeature,
  enabled: boolean
): Promise<ActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(feature in TENANT_EXTRA_FEATURES)) {
    return { ok: false, error: "알 수 없는 기능입니다." };
  }

  const admin = createAdminClient();
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags, updated_at")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };
    if (parseExtraFeatures(tenant.feature_flags)[feature] === enabled) {
      return { ok: true };
    }

    const priorFlags: Record<string, Json | undefined> =
      tenant.feature_flags !== null &&
      typeof tenant.feature_flags === "object" &&
      !Array.isArray(tenant.feature_flags)
        ? (tenant.feature_flags as Record<string, Json | undefined>)
        : {};
    const priorExtra =
      priorFlags.extra_features !== null &&
      typeof priorFlags.extra_features === "object" &&
      !Array.isArray(priorFlags.extra_features)
        ? (priorFlags.extra_features as Record<string, Json>)
        : {};
    const nextFlags: Record<string, Json | undefined> = {
      ...priorFlags,
      extra_features: { ...priorExtra, [feature]: enabled },
    };

    let updateQuery = admin
      .from("tenants")
      .update({
        feature_flags: nextFlags as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);
    updateQuery = tenant.updated_at
      ? updateQuery.eq("updated_at", tenant.updated_at)
      : updateQuery.is("updated_at", null);
    const { data: updated, error } = await updateQuery.select("id");
    if (error) {
      return { ok: false, error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
    }
    saved = (updated ?? []).length > 0;
  }
  if (!saved) {
    return { ok: false, error: "다른 설정 변경과 겹쳤습니다. 잠시 후 다시 시도해 주세요." };
  }

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: "platform_admin",
    action: enabled ? "tenant.extra_feature_on" : "tenant.extra_feature_off",
    resource_type: "tenant",
    resource_id: tenantId,
    after_data: { feature },
  });

  revalidatePath("/platform-admin/tenant-features", "page");
  return { ok: true };
}
