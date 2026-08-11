import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { EXPERT_DOCUMENT_BUCKET } from "@/lib/experts/documents";
import type { Tables } from "@/lib/supabase/database.types";

const SIGNED_URL_EXPIRES_SECONDS = 120;

export type AcceptanceView = {
  acceptance: Tables<"engagement_acceptances">;
  signatureUrl: string | null;
  sealUrl: string | null;
};

/**
 * 단계 28-B: 섭외수락서 열람 데이터 조회.
 * 권한은 RLS에 위임 — 자사 테넌트 또는 전문가 본인만 acceptance 행이 조회된다.
 * 서명·날인 이미지는 service_role 서명 URL로만 노출(공개 URL 금지). 열람은 감사 기록.
 */
export async function getAcceptanceView(
  engagementId: string
): Promise<AcceptanceView | null> {
  if (!hasSupabaseEnv()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: acceptance } = await supabase
    .from("engagement_acceptances")
    .select("*")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (!acceptance) return null;

  const admin = createAdminClient();
  async function sign(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await admin.storage
      .from(EXPERT_DOCUMENT_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);
    return data?.signedUrl ?? null;
  }

  const [signatureUrl, sealUrl] = await Promise.all([
    sign(acceptance.signature_path),
    sign(acceptance.seal_path),
  ]);

  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "engagement_acceptance.view",
    resource_type: "engagement_acceptance",
    resource_id: acceptance.id,
  });

  return { acceptance, signatureUrl, sealUrl };
}
