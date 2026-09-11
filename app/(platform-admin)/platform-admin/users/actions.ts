"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminSession } from "@/lib/admin/platform-session";
import {
  applyResetEmail,
  applyTempPassword,
  loadAuthMeta,
} from "@/lib/admin/password-support-server";
import type { ResetEmailResult, TempPasswordResult } from "@/lib/admin/password-support";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 관리모드 — 기업 이용자 비밀번호 지원 (기획 지시 2026-09-11).
 * 실행·기록은 lib/admin/password-support-server, 여기는 "누구에게 되는가"만.
 */

type Target = {
  id: string;
  tenantId: string;
  email: string;
  appMetadata: Record<string, unknown>;
};

async function loadTarget(
  userId: string
): Promise<{ ok: true; target: Target } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("users")
    .select("id, tenant_id, email, is_active, tenants (status)")
    .eq("id", userId)
    .maybeSingle();
  if (!row) {
    return { ok: false, error: "이용자를 찾을 수 없습니다 — 목록을 새로고침하세요." };
  }
  const tenant = row.tenants as { status: string } | null;
  if (!tenant) return { ok: false, error: "소속 기업을 찾을 수 없습니다." };
  if (tenant.status === "terminated") {
    return { ok: false, error: "해지된 기업의 계정입니다 — 기업을 먼저 활성화해야 합니다." };
  }
  if (!row.is_active) {
    return {
      ok: false,
      error: "비활성 계정입니다 — 그 회사 대표가 임직원 관리에서 활성화한 뒤 다시 시도하세요.",
    };
  }

  const meta = await loadAuthMeta(userId);
  if (!meta.ok) return meta;
  if (meta.isPlatformAdmin) {
    return {
      ok: false,
      error: "플랫폼관리자 계정은 여기서 바꾸지 않습니다 — 본인이 로그인 화면의 '비밀번호 찾기'로 처리합니다.",
    };
  }

  return {
    ok: true,
    target: { id: row.id, tenantId: row.tenant_id, email: row.email, appMetadata: meta.appMetadata },
  };
}

export async function issueTempPassword(userId: string): Promise<TempPasswordResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  const loaded = await loadTarget(userId);
  if (!loaded.ok) return loaded;
  const { target } = loaded;

  const result = await applyTempPassword(target, target.appMetadata, {
    userId: session.userId,
    role: "platform_admin",
  });
  if (result.ok) revalidatePath(`/platform-admin/users/${target.tenantId}`);
  return result;
}

export async function sendUserResetEmail(userId: string): Promise<ResetEmailResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  const loaded = await loadTarget(userId);
  if (!loaded.ok) return loaded;

  return applyResetEmail(loaded.target, { userId: session.userId, role: "platform_admin" });
}
