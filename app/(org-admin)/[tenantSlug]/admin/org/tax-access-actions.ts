"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { RRN_ACCESS_ROLES, type RrnAccessRole } from "@/lib/integrations/rrn-access";

export type TaxAccessResult = { ok: true } | { ok: false; error: string };

type OrgAdminSession =
  | { ok: true; userId: string; tenantId: string; tenantSlug: string }
  | { ok: false; error: string };

/** 기업총괄관리자 세션 확인 — tenant_id는 JWT app_metadata에서만 (CLAUDE.md 3) */
async function requireOrgAdminSession(): Promise<OrgAdminSession> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = tenantIdFromUser(user);
  const tenantSlug = user?.app_metadata?.tenant_slug;
  if (
    !user ||
    !tenantId ||
    roleFromUser(user) !== "org_admin" ||
    typeof tenantSlug !== "string"
  ) {
    return { ok: false, error: "기업총괄관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id, tenantId, tenantSlug };
}

/**
 * 주민번호 조회 지정자 등록 (회계담당·대표만). RLS(tax_access_grants_org_admin_all)가
 * 본 테넌트 org_admin만 허용한다. 지정 대상은 같은 테넌트의 활성 직원이어야 한다.
 */
export async function grantTaxAccess(input: {
  userId: string;
  roleLabel: RrnAccessRole;
}): Promise<TaxAccessResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  if (!(input.roleLabel in RRN_ACCESS_ROLES)) {
    return { ok: false, error: "역할을 확인하세요." };
  }

  const supabase = createClient();

  // 대상이 같은 테넌트의 활성 직원인지 확인
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id, is_active")
    .eq("id", input.userId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId || !target.is_active) {
    return { ok: false, error: "같은 기업의 활성 직원만 지정할 수 있습니다." };
  }

  // 이미 활성 지정이 있으면 중복 방지
  const { data: existing } = await supabase
    .from("tax_access_grants")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "이미 지정된 담당자입니다." };
  }

  const { error } = await supabase.from("tax_access_grants").insert({
    tenant_id: session.tenantId,
    user_id: input.userId,
    role_label: RRN_ACCESS_ROLES[input.roleLabel],
    granted_by: session.userId,
  });
  if (error) {
    return { ok: false, error: "지정에 실패했습니다." };
  }

  revalidatePath(`/${session.tenantSlug}/admin/org`);
  return { ok: true };
}

/** 조회 지정 해제 (revoke — 삭제 대신 비활성 §14-4). */
export async function revokeTaxAccess(grantId: string): Promise<TaxAccessResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  const supabase = createClient();
  const { error } = await supabase
    .from("tax_access_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("tenant_id", session.tenantId)
    .is("revoked_at", null);
  if (error) {
    return { ok: false, error: "해제에 실패했습니다." };
  }

  revalidatePath(`/${session.tenantSlug}/admin/org`);
  return { ok: true };
}
