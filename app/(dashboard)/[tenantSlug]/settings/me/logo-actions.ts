"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import {
  TENANT_LOGO_BUCKET,
  TENANT_LOGO_MAX_BYTES,
} from "@/lib/branding/tenant-logo";

export type LogoResult = { ok: true } | { ok: false; error: string };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 회사 로고 등록 (대표 또는 '테넌트 설정' 위임자).
 *
 * 브라우저가 캔버스로 400px PNG까지 줄여서 보낸다. 서버는 그 결과를 믿지 않고
 * 형식(PNG 시그니처)과 용량을 다시 확인한다 — 클라이언트 검증은 편의이지
 * 방어가 아니다 (CLAUDE.md §12-5).
 *
 * SVG는 받지 않는다. SVG는 스크립트를 품을 수 있는 문서라서, 이미지처럼 보이지만
 * 이미지가 아니다.
 */
export async function saveTenantLogo(dataUrl: string): Promise<LogoResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) {
    return {
      ok: false,
      error: "회사 로고는 대표 또는 ‘테넌트 설정’ 위임자만 바꿀 수 있습니다.",
    };
  }

  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, error: "이미지 형식을 확인할 수 없습니다." };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), "base64");
  } catch {
    return { ok: false, error: "이미지를 해석할 수 없습니다." };
  }
  if (bytes.length === 0) return { ok: false, error: "빈 이미지입니다." };
  if (bytes.length > TENANT_LOGO_MAX_BYTES) {
    return { ok: false, error: "로고 용량이 너무 큽니다. 더 작은 이미지를 쓰세요." };
  }
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return { ok: false, error: "PNG 이미지만 등록할 수 있습니다." };
  }

  const admin = createAdminClient();
  const path = `tenant-logos/${session.tenantId}/logo-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await admin.storage
    .from(TENANT_LOGO_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다." };

  const { data: prior } = await admin
    .from("tenants")
    .select("logo_url")
    .eq("id", session.tenantId)
    .maybeSingle();

  const { error } = await admin
    .from("tenants")
    .update({ logo_url: path, updated_at: new Date().toISOString() })
    .eq("id", session.tenantId);
  if (error) {
    await admin.storage.from(TENANT_LOGO_BUCKET).remove([path]);
    return { ok: false, error: "저장에 실패했습니다." };
  }

  // 이전 로고는 지운다 — 쓰지 않는 파일을 계속 쌓아 두지 않는다
  if (prior?.logo_url && prior.logo_url !== path) {
    await admin.storage.from(TENANT_LOGO_BUCKET).remove([prior.logo_url]);
  }

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "tenant.update_logo",
    resource_type: "tenant",
    resource_id: session.tenantId,
  });

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}

/** 로고 제거 — 기본 캐스트로그 심볼로 되돌아간다 */
export async function removeTenantLogo(): Promise<LogoResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("settings");
  if (!session.ok) {
    return {
      ok: false,
      error: "회사 로고는 대표 또는 ‘테넌트 설정’ 위임자만 바꿀 수 있습니다.",
    };
  }

  const admin = createAdminClient();
  const { data: prior } = await admin
    .from("tenants")
    .select("logo_url")
    .eq("id", session.tenantId)
    .maybeSingle();

  const { error } = await admin
    .from("tenants")
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", session.tenantId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  if (prior?.logo_url) {
    await admin.storage.from(TENANT_LOGO_BUCKET).remove([prior.logo_url]);
  }

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "tenant.remove_logo",
    resource_type: "tenant",
    resource_id: session.tenantId,
  });

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}
