import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { EXPERT_DOCUMENT_BUCKET } from "@/lib/experts/documents";
import { ensurePracticeAcceptance } from "@/lib/integrations/acceptance";
import { getPublicTenantBrand } from "@/lib/branding/tenant-logo";
import type { Tables } from "@/lib/supabase/database.types";

const SIGNED_URL_EXPIRES_SECONDS = 120;
/**
 * 첨부는 화면 안에서 열어 보므로 서명·날인 이미지보다 여유를 둔다.
 * (수락서를 읽는 도중 첨부를 눌렀을 때 URL이 만료돼 있으면 안 된다)
 */
const ATTACHMENT_URL_EXPIRES_SECONDS = 600;

export type AcceptanceAttachmentView = {
  id: string;
  fileName: string;
  /** 화면 내 인라인 열람용 서명 만료 URL (공개 URL 금지) */
  url: string | null;
  mimeType: string | null;
};

export type AcceptanceView = {
  acceptance: Tables<"engagement_acceptances">;
  /** 발행 기업 로고 (화이트라벨 — CLAUDE.md §16) */
  logoSrc: string | null;
  signatureUrl: string | null;
  sealUrl: string | null;
  /** 찾아오시는 길(약도) 이미지 — 서명 만료 URL */
  mapUrl: string | null;
  /** 동봉 첨부파일 — 서명 만료 URL */
  attachments: AcceptanceAttachmentView[];
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

  async function readAcceptance() {
    const { data } = await supabase
      .from("engagement_acceptances")
      .select("*")
      .eq("engagement_id", engagementId)
      .maybeSingle();
    return data;
  }

  let acceptance = await readAcceptance();
  if (!acceptance) {
    // 연습모드 확정 건은 수락서가 없어도 화면이 열려야 한다 — 없으면 그 자리에서
    // 가상 수락서를 만든다. RLS로 이 섭외 건을 볼 수 있는 사람만 여기 도달한다.
    // (실데이터 건은 ensurePracticeAcceptance가 스스로 거부한다 — 서명한 적 없는
    //  문서를 시스템이 지어내면 안 된다)
    const { data: engagement } = await supabase
      .from("expert_engagements")
      .select("id")
      .eq("id", engagementId)
      .maybeSingle();
    if (!engagement) return null;
    if (!(await ensurePracticeAcceptance(engagementId))) return null;
    acceptance = await readAcceptance();
  }
  if (!acceptance) return null;

  const admin = createAdminClient();
  async function sign(
    path: string | null,
    expiresIn = SIGNED_URL_EXPIRES_SECONDS
  ): Promise<string | null> {
    if (!path) return null;
    const { data } = await admin.storage
      .from(EXPERT_DOCUMENT_BUCKET)
      .createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
  }

  // 첨부는 service_role로 조회 — 전문가 세션은 tenant RLS 밖이므로 여기서 처리한다.
  const { data: attachmentRows } = await admin
    .from("engagement_acceptance_attachments")
    .select("id, file_name, storage_path, mime_type")
    .eq("acceptance_id", acceptance.id)
    .order("created_at", { ascending: true });

  const [signatureUrl, sealUrl, mapUrl, attachments] = await Promise.all([
    sign(acceptance.signature_path),
    sign(acceptance.seal_path),
    sign(acceptance.map_image_path),
    Promise.all(
      (attachmentRows ?? []).map(async (a) => ({
        id: a.id,
        fileName: a.file_name,
        mimeType: a.mime_type,
        url: await sign(a.storage_path, ATTACHMENT_URL_EXPIRES_SECONDS),
      }))
    ),
  ]);

  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "engagement_acceptance.view",
    resource_type: "engagement_acceptance",
    resource_id: acceptance.id,
  });

  const brand = await getPublicTenantBrand(acceptance.tenant_id);

  return {
    acceptance,
    logoSrc: brand.logoSrc,
    signatureUrl,
    sealUrl,
    mapUrl,
    attachments,
  };
}
