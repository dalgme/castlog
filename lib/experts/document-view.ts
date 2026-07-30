import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

import { EXPERT_DOCUMENT_BUCKET } from "./documents";

/** 서명 URL 유효시간 (초) — 짧게 유지, 재열람은 재발급 */
const SIGNED_URL_EXPIRES_SECONDS = 60;

/**
 * 서류 열람 서명 URL 발급 (설계문서 4.4 / CLAUDE.md 5·12-4)
 *
 * - 권한 판정은 RLS에 위임: 세션 클라이언트로 조회되는 문서만 열람 가능
 *   (전문가 본인 or 활성 연결 + 열람 허용 grants가 있는 기업).
 * - 모든 열람은 audit_logs 기록. 파일 접근은 service_role 서명 URL로만.
 */
export async function issueDocumentViewUrl(
  documentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "server_not_configured" };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }

  // RLS가 권한을 판정한다 — 조회 불가면 열람 권한 없음
  const { data: document } = await supabase
    .from("expert_documents")
    .select("id, expert_id, document_type, storage_path, status")
    .eq("id", documentId)
    .maybeSingle();

  if (!document || document.status === "destroyed") {
    return { ok: false, error: "not_found" };
  }

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_EXPIRES_SECONDS);

  if (signError || !signed) {
    return { ok: false, error: "sign_failed" };
  }

  // 민감정보 조회 감사 로그 (CLAUDE.md 12-4). 전문가 본인 열람은 tenant null.
  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "expert_document.view",
    resource_type: "expert_document",
    resource_id: document.id,
    after_data: { document_type: document.document_type },
  });

  return { ok: true, url: signed.signedUrl };
}
