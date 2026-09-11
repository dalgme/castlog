"use server";

import { revalidatePath } from "next/cache";

import { requireAdminScope } from "@/lib/auth/admin-scopes";
import {
  applyResetEmail,
  applyTempPassword,
  loadAuthMeta,
} from "@/lib/admin/password-support-server";
import type { ResetEmailResult, TempPasswordResult } from "@/lib/admin/password-support";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 임직원 관리 — 소속 직원 비밀번호 리셋 (기획 지시 2026-09-11).
 *
 * 게이트는 '직원·직급 관리'(staff) 스코프다 — 계정을 만들고 비활성화하는 사람이
 * 비밀번호도 풀어 준다. 다만 **대표 계정은 대표만** 건드릴 수 있다: 위임받은
 * 직원이 대표 비밀번호를 리셋하면 그 자리에서 대표 계정을 가져가는 셈이다.
 * 본인 것은 여기서 하지 않는다 — 내 설정의 비밀번호 변경이 그 자리다.
 */

type Target = {
  id: string;
  tenantId: string;
  email: string;
  appMetadata: Record<string, unknown>;
};

type Session = { userId: string; tenantId: string; isCeo: boolean };

async function loadTarget(
  session: Session,
  userId: string
): Promise<{ ok: true; target: Target } | { ok: false; error: string }> {
  if (userId === session.userId) {
    return { ok: false, error: "본인 비밀번호는 내 설정 > 비밀번호 변경에서 바꿉니다." };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("users")
    .select("id, tenant_id, email, grade, is_active")
    .eq("id", userId)
    .maybeSingle();
  // 다른 회사 계정은 '없는 계정'으로 답한다 — 존재 여부도 알려 주지 않는다
  if (!row || row.tenant_id !== session.tenantId) {
    return { ok: false, error: "대상 직원을 찾을 수 없습니다 — 목록을 새로고침하세요." };
  }
  if (!row.is_active) {
    return { ok: false, error: "비활성 계정입니다 — 먼저 활성화한 뒤 다시 시도하세요." };
  }
  if (row.grade === "ceo" && !session.isCeo) {
    return { ok: false, error: "대표 계정의 비밀번호는 대표만 리셋할 수 있습니다 (규칙)." };
  }

  const meta = await loadAuthMeta(userId);
  if (!meta.ok) return meta;
  if (meta.isPlatformAdmin) {
    return { ok: false, error: "플랫폼관리자 계정은 여기서 바꾸지 않습니다." };
  }

  return {
    ok: true,
    target: { id: row.id, tenantId: row.tenant_id, email: row.email, appMetadata: meta.appMetadata },
  };
}

function revalidateStaff() {
  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
}

export async function issueStaffTempPassword(userId: string): Promise<TempPasswordResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  const loaded = await loadTarget(session, userId);
  if (!loaded.ok) return loaded;
  const { target } = loaded;

  const result = await applyTempPassword(target, target.appMetadata, {
    userId: session.userId,
    role: session.isCeo ? "org_admin" : "manager",
  });
  if (result.ok) revalidateStaff();
  return result;
}

export async function sendStaffResetEmail(userId: string): Promise<ResetEmailResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  const loaded = await loadTarget(session, userId);
  if (!loaded.ok) return loaded;

  return applyResetEmail(loaded.target, {
    userId: session.userId,
    role: session.isCeo ? "org_admin" : "manager",
  });
}
