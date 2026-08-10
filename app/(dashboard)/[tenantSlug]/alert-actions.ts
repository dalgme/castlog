"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

export type AlertActionResult = { ok: true } | { ok: false; error: string };

/**
 * 단계 29: 전사 알림 확인(닫기) — 관리자 이상.
 * 긴급 알림을 임의로 지우지 않도록 권한을 제한한다 (RLS와 이중 확인).
 */
export async function dismissTenantAlert(
  alertId: string
): Promise<AlertActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "알림을 닫을 권한이 없습니다." };
  }

  const { data: updated, error } = await supabase
    .from("tenant_alerts")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: user.id })
    .eq("id", alertId)
    .is("dismissed_at", null)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "닫을 수 없는 알림입니다." };
  }

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}
