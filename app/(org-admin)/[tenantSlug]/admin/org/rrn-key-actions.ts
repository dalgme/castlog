"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

export type RrnKeyResult = { ok: true } | { ok: false; error: string };

/** 클라이언트에서 생성한 테넌트 키 재료 (조회 비밀번호는 포함되지 않는다) */
export type TenantKeyMaterialInput = {
  publicKeyJwk: unknown;
  wrappedPrivateKey: string;
  kdfSalt: string;
  kdfParams: unknown;
  wrapIv: string;
  alg: string;
};

async function requireOrgAdmin(): Promise<
  | { ok: true; tenantId: string; tenantSlug: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const tenantSlug = user?.app_metadata?.tenant_slug;
  if (!user || !tenantId || roleFromUser(user) !== "org_admin" || typeof tenantSlug !== "string") {
    return { ok: false, error: "기업총괄관리자 권한이 필요합니다." };
  }
  return { ok: true, tenantId, tenantSlug };
}

/**
 * 테넌트 RRN 키페어 저장 — 개인키는 이미 클라이언트에서 조회 비밀번호로 래핑됨.
 * deny-all 테이블이라 service_role(admin client)로 upsert하며, 권한은 코드로 검증한다.
 * 조회 비밀번호는 서버로 전송되지 않는다(키 재료만 수신).
 */
export async function saveTenantRrnKey(
  material: TenantKeyMaterialInput
): Promise<RrnKeyResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const session = await requireOrgAdmin();
  if (!session.ok) return session;

  if (
    !material.publicKeyJwk ||
    typeof material.wrappedPrivateKey !== "string" ||
    typeof material.kdfSalt !== "string" ||
    typeof material.wrapIv !== "string"
  ) {
    return { ok: false, error: "키 재료가 올바르지 않습니다." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("tenant_rrn_keys").upsert(
    {
      tenant_id: session.tenantId,
      public_key_jwk: material.publicKeyJwk as never,
      wrapped_private_key: material.wrappedPrivateKey,
      kdf_salt: material.kdfSalt,
      kdf_params: material.kdfParams as never,
      wrap_iv: material.wrapIv,
      alg: material.alg,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (error) return { ok: false, error: "키 저장에 실패했습니다." };

  revalidatePath(`/${session.tenantSlug}/admin/org`);
  return { ok: true };
}
