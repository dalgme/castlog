"use server";

import { revalidatePath } from "next/cache";
import { readUploadFileName } from "@/lib/files/upload-name";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";

export type CertificateActionResult = { ok: true } | { ok: false; error: string };

type Gate =
  | { ok: true; expertId: string; userId: string }
  | { ok: false; error: string };

async function gate(): Promise<Gate> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가 프로필이 없습니다." };

  return { ok: true, expertId: expert.id, userId: user.id };
}

/**
 * 자격증 사본 업로드 (기획 확정 2026-08-22 — 다건 보유).
 * certificateId가 있으면 그 자격증의 파일을 교체(수정 등록)한다 — 기존 파일은
 * 'replaced'로 이력 보존, 새 파일이 그 자리를 잇는다. 없으면 새 자격증 추가.
 */
export async function uploadCertificateFile(
  formData: FormData
): Promise<CertificateActionResult> {
  const g = await gate();
  if (!g.ok) return g;

  const file = formData.get("file");
  const certificateIdRaw = formData.get("certificateId");
  const certificateId =
    typeof certificateIdRaw === "string" && certificateIdRaw ? certificateIdRaw : null;

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }
  // 한글 파일명 보전 — 클라이언트 fileName 필드 우선, mojibake 복원 (lib/files/upload-name)
  const fileName = readUploadFileName(formData, file);
  const validation = validateDocumentFile(file.type, fileName, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = createClient();

  // 교체 대상이면 본인 소유인지 확인
  let replacingDocId: string | null = null;
  if (certificateId) {
    const { data: cert } = await supabase
      .from("expert_certificates")
      .select("id, document_id")
      .eq("id", certificateId)
      .eq("expert_id", g.expertId)
      .maybeSingle();
    if (!cert) return { ok: false, error: "대상 자격증을 찾을 수 없습니다." };
    replacingDocId = cert.document_id;
  }

  const storagePath = `${g.expertId}/certificate/${crypto.randomUUID()}.${validation.extension}`;
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

  const { data: createdDoc, error: docError } = await supabase
    .from("expert_documents")
    .insert({
      expert_id: g.expertId,
      document_type: "certificate",
      storage_path: storagePath,
      file_name: fileName,
      file_size_bytes: file.size,
      mime_type: validation.contentType,
    })
    .select("id")
    .single();
  if (docError || !createdDoc) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
    return { ok: false, error: "서류 등록에 실패했습니다. 마이그레이션 미적용(certificate 유형)일 수 있습니다 — 캐스트로그에 알려 주세요." };
  }

  if (certificateId && replacingDocId) {
    // 파일 교체 — 자격증 정보(작성 내용)는 유지, 문서만 새 것으로
    const { error: linkError } = await supabase
      .from("expert_certificates")
      .update({ document_id: createdDoc.id })
      .eq("id", certificateId)
      .eq("expert_id", g.expertId);
    if (linkError) {
      return { ok: false, error: "자격증 파일 교체에 실패했습니다." };
    }
    await supabase
      .from("expert_documents")
      .update({ status: "replaced" })
      .eq("id", replacingDocId)
      .eq("expert_id", g.expertId);
    await supabase.from("expert_document_history").insert({
      document_id: createdDoc.id,
      expert_id: g.expertId,
      action: "replaced",
      actor_auth_user_id: g.userId,
    });
  } else {
    const { error: certError } = await supabase
      .from("expert_certificates")
      .insert({ expert_id: g.expertId, document_id: createdDoc.id });
    if (certError) {
      return { ok: false, error: "자격증 등록에 실패했습니다." };
    }
    await supabase.from("expert_document_history").insert({
      document_id: createdDoc.id,
      expert_id: g.expertId,
      action: "created",
      actor_auth_user_id: g.userId,
    });
  }

  await supabase.from("audit_logs").insert({
    tenant_id: null, // 전문가 본인 행위 — 전역
    actor_auth_user_id: g.userId,
    actor_role: "expert",
    action: certificateId ? "expert_document.replace" : "expert_document.upload",
    resource_type: "expert_document",
    resource_id: createdDoc.id,
    after_data: { document_type: "certificate" },
  });

  revalidatePath("/expert/documents");
  return { ok: true };
}

const certInfoSchema = z.object({
  certName: z.string().trim().max(100),
  issuedOn: z.string().trim().max(50),
  issuer: z.string().trim().max(100),
  note: z.string().trim().max(500),
});

/** 자격증 정보(자격증명·급수 / 발급일 / 발급기관 / 기타) 저장 */
export async function saveCertificateInfo(
  certificateId: string,
  input: { certName: string; issuedOn: string; issuer: string; note: string }
): Promise<CertificateActionResult> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = certInfoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("expert_certificates")
    .update({
      cert_name: parsed.data.certName || null,
      issued_on: parsed.data.issuedOn || null,
      issuer: parsed.data.issuer || null,
      note: parsed.data.note || null,
    })
    .eq("id", certificateId)
    .eq("expert_id", g.expertId);
  if (error) return { ok: false, error: "자격증 정보 저장에 실패했습니다." };

  revalidatePath("/expert/documents");
  return { ok: true };
}

/** 자격증 삭제 — 파일은 'replaced'로 이력 보존, 목록에서만 사라진다 */
export async function deleteCertificate(
  certificateId: string
): Promise<CertificateActionResult> {
  const g = await gate();
  if (!g.ok) return g;

  const supabase = createClient();
  const { data: cert } = await supabase
    .from("expert_certificates")
    .select("id, document_id")
    .eq("id", certificateId)
    .eq("expert_id", g.expertId)
    .maybeSingle();
  if (!cert) return { ok: false, error: "대상 자격증을 찾을 수 없습니다." };

  const { error: deleteError } = await supabase
    .from("expert_certificates")
    .delete()
    .eq("id", certificateId)
    .eq("expert_id", g.expertId);
  if (deleteError) return { ok: false, error: "삭제에 실패했습니다." };

  await supabase
    .from("expert_documents")
    .update({ status: "replaced" })
    .eq("id", cert.document_id)
    .eq("expert_id", g.expertId);
  await supabase.from("expert_document_history").insert({
    document_id: cert.document_id,
    expert_id: g.expertId,
    action: "replaced",
    actor_auth_user_id: g.userId,
  });

  await supabase.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: g.userId,
    actor_role: "expert",
    action: "expert_document.remove",
    resource_type: "expert_document",
    resource_id: cert.document_id,
    after_data: { document_type: "certificate" },
  });

  revalidatePath("/expert/documents");
  return { ok: true };
}
