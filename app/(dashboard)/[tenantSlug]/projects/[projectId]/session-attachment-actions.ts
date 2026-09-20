"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingTableError } from "@/lib/supabase/errors";
import { explainActionError } from "@/lib/ux/action-errors";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { isPracticeMode } from "@/lib/practice/server";
import { readUploadFileName } from "@/lib/files/upload-name";
import { EXPERT_DOCUMENT_BUCKET, validateDocumentFile } from "@/lib/experts/documents";

/**
 * 지급 품의 탭 · 세션별 파일 첨부 (기획 지시 2026-09-21) — 세션당 여러 파일, 드래그 일괄 업로드.
 * 업로드 파이프라인은 다른 첨부와 같다: 서버 검증(용량·확장자, §12-5) → admin 업로드 →
 * 행 insert(RLS: 프로젝트 팀) → 실패 롤백. 열람은 서명된 만료 URL (§5).
 */

type Result = { ok: true } | { ok: false; error: string };

const TABLE_MISSING =
  "세션 첨부 기능이 아직 이 서버에 준비되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션(0010) 적용을 요청해 주세요.";

async function requireStaff(): Promise<
  { ok: true; userId: string; tenantId: string; role: string } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

export type UploadSessionResult =
  | { ok: true; uploaded: number; failed: { name: string; error: string }[] }
  | { ok: false; error: string };

/** 여러 파일 한 번에 — formData의 'files'를 전부 처리하고 파일별 실패를 돌려준다 */
export async function uploadSessionPaymentAttachments(formData: FormData): Promise<UploadSessionResult> {
  const auth = await requireStaff();
  if (!auth.ok) return auth;

  const projectId = formData.get("projectId");
  const slotId = formData.get("slotId");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const names = formData.getAll("fileNames").map((n) => (typeof n === "string" ? n : ""));
  if (typeof projectId !== "string" || typeof slotId !== "string" || files.length === 0) {
    return { ok: false, error: "첨부할 파일을 선택하세요." };
  }
  if (files.length > 20) {
    return { ok: false, error: "한 번에 20개까지 올릴 수 있습니다." };
  }

  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id")
    .eq("id", slotId)
    .eq("tenant_id", auth.tenantId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "대상 세션을 찾을 수 없습니다." };

  const admin = createAdminClient();
  const practice = await isPracticeMode();
  const failed: { name: string; error: string }[] = [];
  let uploaded = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i] as File;
    const single = new FormData();
    if (names[i]) single.set("fileName", names[i] as string);
    const fileName = readUploadFileName(single, file);
    const validated = validateDocumentFile(file.type, fileName, file.size);
    if (!validated.ok) {
      failed.push({ name: fileName, error: validated.error });
      continue;
    }
    const storagePath = `session-attachments/${auth.tenantId}/${projectId}/${slotId}-${crypto.randomUUID()}.${validated.extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(EXPERT_DOCUMENT_BUCKET)
      .upload(storagePath, bytes, { contentType: validated.contentType });
    if (uploadError) {
      failed.push({ name: fileName, error: "파일 업로드에 실패했습니다 (시스템 오류)." });
      continue;
    }
    const { error: rowError } = await supabase.from("session_payment_attachments").insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      slot_id: slotId,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: validated.contentType,
      file_size_bytes: file.size,
      uploaded_by: auth.userId,
      is_practice: practice,
    });
    if (rowError) {
      await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
      if (isMissingTableError(rowError)) return { ok: false, error: TABLE_MISSING };
      failed.push({
        name: fileName,
        error: await explainActionError(rowError.message, "첨부 기록에 실패했습니다 (시스템 오류)."),
      });
      continue;
    }
    uploaded += 1;
  }

  if (uploaded > 0) {
    await supabase.from("audit_logs").insert({
      tenant_id: auth.tenantId,
      actor_auth_user_id: auth.userId,
      actor_role: auth.role,
      action: "session_attachment.upload",
      resource_type: "engagement_slot",
      resource_id: slotId,
      after_data: { project_id: projectId, count: uploaded, failed: failed.length },
    });
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  }
  return { ok: true, uploaded, failed };
}

export async function deleteSessionPaymentAttachment(attachmentId: string): Promise<Result> {
  const auth = await requireStaff();
  if (!auth.ok) return auth;
  const supabase = createClient();
  const { data: row } = await supabase
    .from("session_payment_attachments")
    .select("id, slot_id, storage_path, file_name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "첨부를 찾을 수 없습니다." };
  const { error } = await supabase.from("session_payment_attachments").delete().eq("id", attachmentId);
  if (error) {
    return { ok: false, error: await explainActionError(error.message, "첨부 삭제에 실패했습니다 (시스템 오류).") };
  }
  const { error: removeError } = await createAdminClient()
    .storage.from(EXPERT_DOCUMENT_BUCKET)
    .remove([row.storage_path]);
  if (removeError) console.warn("[session-attach] file remove failed:", row.storage_path);
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "session_attachment.delete",
    resource_type: "engagement_slot",
    resource_id: row.slot_id,
    after_data: { file_name: row.file_name },
  });
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 열람 — 서명된 만료 URL (공개 URL 금지 §5). 열람도 감사에 남긴다 */
export async function getSessionPaymentAttachmentUrl(
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await requireStaff();
  if (!auth.ok) return auth;
  const supabase = createClient();
  const { data: row } = await supabase
    .from("session_payment_attachments")
    .select("id, slot_id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "첨부를 찾을 수 없습니다 (권한 규칙 또는 삭제됨)." };
  const { data: signed, error } = await createAdminClient()
    .storage.from(EXPERT_DOCUMENT_BUCKET)
    .createSignedUrl(row.storage_path, 60);
  if (error || !signed?.signedUrl) {
    return { ok: false, error: "열람 링크 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "session_attachment.view",
    resource_type: "engagement_slot",
    resource_id: row.slot_id,
  });
  return { ok: true, url: signed.signedUrl };
}
