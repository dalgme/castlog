"use server";

import { revalidatePath } from "next/cache";
import { readUploadFileName } from "@/lib/files/upload-name";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  EXPERT_DOCUMENT_BUCKET,
  isGrantableDocumentType,
  isUploadableDocumentType,
  validateDocumentFile,
} from "@/lib/experts/documents";
import { CURRENT_TERMS_VERSION } from "@/lib/experts/schemas";

export type DocumentActionResult = { ok: true } | { ok: false; error: string };

/**
 * 전문가 서류 업로드 (본인만 — 설계문서 10.1)
 * 같은 유형의 기존 서류는 'replaced'로 전환한다 (이력 보존).
 * 민감 서류는 리사이즈 없이 원본 저장. 스토리지 접근은 service_role 전용.
 */
export async function uploadExpertDocument(
  formData: FormData
): Promise<DocumentActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) {
    return { ok: false, error: "전문가 프로필이 없습니다." };
  }

  const documentType = formData.get("documentType");
  const file = formData.get("file");

  if (typeof documentType !== "string" || !isUploadableDocumentType(documentType)) {
    return { ok: false, error: "지원하지 않는 서류 유형입니다." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }
  // 한글 파일명 보전 — 클라이언트 fileName 필드 우선, mojibake 복원 (lib/files/upload-name)
  const fileName = readUploadFileName(formData, file);

  // 용량·확장자 서버 검증 (CLAUDE.md 12-5)
  const validation = validateDocumentFile(file.type, fileName, file.size);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const storagePath = `${expert.id}/${documentType}/${crypto.randomUUID()}.${validation.extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: "파일 업로드에 실패했습니다. 다시 시도해 주세요." };
  }

  // 기존 활성 서류 → replaced (이력 보존)
  const { data: previousDocs } = await supabase
    .from("expert_documents")
    .select("id")
    .eq("expert_id", expert.id)
    .eq("document_type", documentType)
    .eq("status", "active");

  const { data: created, error: insertError } = await supabase
    .from("expert_documents")
    .insert({
      expert_id: expert.id,
      document_type: documentType,
      storage_path: storagePath,
      file_name: fileName,
      file_size_bytes: file.size,
      mime_type: validation.contentType,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    // 메타데이터 실패 시 고아 파일 정리
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
    return { ok: false, error: "서류 등록에 실패했습니다. 다시 시도해 주세요." };
  }

  const historyRows = [
    {
      document_id: created.id,
      expert_id: expert.id,
      action: previousDocs && previousDocs.length > 0 ? "replaced" : "created",
      actor_auth_user_id: user.id,
    },
  ];

  if (previousDocs && previousDocs.length > 0) {
    await supabase
      .from("expert_documents")
      .update({ status: "replaced" })
      .in(
        "id",
        previousDocs.map((d) => d.id)
      );
  }

  await supabase.from("expert_document_history").insert(historyRows);

  await supabase.from("audit_logs").insert({
    tenant_id: null, // 전문가 본인 행위 — 전역
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "expert_document.upload",
    resource_type: "expert_document",
    resource_id: created.id,
    after_data: { document_type: documentType },
  });

  revalidatePath("/expert/documents");
  return { ok: true };
}

/**
 * 기업별 서류 열람 허용·회수 (설계문서 10.1 — 허용의 주체는 서류 소유자인 전문가)
 * 허용 시 document_share_tenant 동의를 연결 건별로 기록한다 (설계문서 14.6).
 */
export async function setDocumentGrant(
  linkId: string,
  documentType: string,
  granted: boolean
): Promise<DocumentActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  // 허용 대상 = 표준 슬롯 + 자격증 사본 (attachment는 grants 대상이 아니다 —
  // DB check 제약과도 일치해야 한다)
  if (!isGrantableDocumentType(documentType)) {
    return { ok: false, error: "지원하지 않는 서류 유형입니다." };
  }

  // 본인 소유 연결인지 확인 (RLS와 이중 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, tenant_id, status, experts!inner(auth_user_id)")
    .eq("id", linkId)
    .maybeSingle();

  if (!link || link.experts?.auth_user_id !== user.id) {
    return { ok: false, error: "권한이 없는 연결입니다." };
  }
  if (link.status !== "active") {
    return { ok: false, error: "활성 상태의 연결에만 열람 허용을 설정할 수 있습니다." };
  }

  if (granted) {
    const { error: upsertError } = await supabase
      .from("expert_document_grants")
      .upsert(
        {
          link_id: linkId,
          document_type: documentType,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "link_id,document_type" }
      );
    if (upsertError) {
      return { ok: false, error: "열람 허용 설정에 실패했습니다." };
    }

    // 연결 기업 제공 동의 — 연결 건별 개별 기록
    await supabase.from("consents").insert({
      auth_user_id: user.id,
      consent_type: "document_share_tenant",
      granted: true,
      terms_version: CURRENT_TERMS_VERSION,
      target_tenant_id: link.tenant_id,
    });
  } else {
    const { error: revokeError } = await supabase
      .from("expert_document_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("link_id", linkId)
      .eq("document_type", documentType);
    if (revokeError) {
      return { ok: false, error: "열람 회수에 실패했습니다." };
    }
  }

  // 전문가 세션의 JWT tenant_id와 무관하게 대상 테넌트로 기록해야 하므로 admin 사용
  // (audit_logs RLS는 자기 테넌트 범위만 허용 — 전문가는 해당 테넌트 소속이 아님)
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    tenant_id: link.tenant_id,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: granted ? "expert_document_grant.grant" : "expert_document_grant.revoke",
    resource_type: "expert_document_grant",
    resource_id: linkId,
    after_data: { document_type: documentType },
  });

  revalidatePath("/expert/documents");
  return { ok: true };
}
