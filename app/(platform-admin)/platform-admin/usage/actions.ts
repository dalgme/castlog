"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { logAudit } from "@/lib/audit/log";

export type SnapshotResult =
  | { ok: true; tenants: number }
  | { ok: false; error: string };

/**
 * 사용량 스냅샷 수동 실행 — 플랫폼관리자 전용.
 * 함수는 service_role만 실행 가능(revoke)하므로 admin 클라이언트로 rpc.
 */
export async function runUsageSnapshot(): Promise<SnapshotResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const user = await requireRole(["platform_admin"]);
  if (!user) return { ok: false, error: "권한이 없습니다." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("snapshot_tenant_usage");
  if (error) {
    return { ok: false, error: "집계 실행에 실패했습니다. 다시 시도하세요." };
  }

  await logAudit(createClient(), user, {
    action: "usage.snapshot",
    resourceType: "tenant_usage_metrics",
    afterData: { tenants: data ?? 0 },
  });

  revalidatePath("/platform-admin/usage", "page");
  return { ok: true, tenants: data ?? 0 };
}
