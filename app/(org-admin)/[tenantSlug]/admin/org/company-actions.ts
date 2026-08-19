"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import {
  companyProfileSchema,
  type CompanyProfileInput,
} from "@/lib/admin/company-schemas";

export type CompanyProfileResult = { ok: true } | { ok: false; error: string };

/**
 * 기업 가입정보·개인정보 보호책임자 저장 (대표 또는 settings 위임자).
 *
 * 개인정보 보호책임자 지정은 개인정보보호법 제31조의 의무다. 테넌트가 임직원·
 * 전문가의 개인정보를 처리하는 주체이므로, 플랫폼 운영사가 아니라 **테넌트별로**
 * 지정하고 공개해야 한다.
 *
 * 기업명·슬러그·모듈 조합은 여기서 바꾸지 않는다 — 계약 정보라 캐스트로그
 * 관리모드에서 다룬다.
 */
export async function saveCompanyProfile(
  input: CompanyProfileInput
): Promise<CompanyProfileResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) return session;

  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("tenants")
    .update({
      business_registration_number: d.businessRegistrationNumber || null,
      representative_name: d.representativeName || null,
      address: d.address || null,
      contact_phone: d.contactPhone || null,
      industry: d.industry || null,
      privacy_officer_name: d.privacyOfficerName || null,
      privacy_officer_email: d.privacyOfficerEmail || null,
      privacy_officer_phone: d.privacyOfficerPhone || null,
    })
    .eq("id", session.tenantId);
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "tenant.update_profile",
    resource_type: "tenant",
    resource_id: session.tenantId,
    // 값 자체는 남기지 않는다 — 감사로그는 메타데이터만 (CLAUDE.md §12-4)
    after_data: { privacy_officer_set: Boolean(d.privacyOfficerName) },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}
