"use server";

import { revalidatePath } from "next/cache";
import { readUploadFileName } from "@/lib/files/upload-name";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { canManagePayments } from "@/lib/auth/admin-scopes";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { isPracticeMode } from "@/lib/practice/server";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";

/**
 * 종료 품의 증빙 첨부 (기획 확정 2026-08-30) — 참여 건(전문가×세션)당
 * 파일 1개, 선택. 업로드 파이프라인은 프로젝트 첨부와 동일:
 * 서버 검증(용량·확장자, §12-5) → admin 업로드 → 행 insert(RLS) → 실패 롤백.
 * 게이트는 만족도 입력과 같은 축(expertRecord — 기본 레벨 4).
 */

type AttachResult = { ok: true } | { ok: false; error: string };

export async function uploadSettlementLineAttachment(
  formData: FormData
): Promise<AttachResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const auth = await requireExecGrade("expertRecord");
  if (!auth.ok) return auth;

  const projectId = formData.get("projectId");
  const engagementId = formData.get("engagementId");
  const file = formData.get("file");
  if (
    typeof projectId !== "string" ||
    typeof engagementId !== "string" ||
    !(file instanceof File) ||
    file.size === 0
  ) {
    return { ok: false, error: "첨부할 파일을 선택하세요." };
  }

  const supabase = createClient();
  // 대상 확인 — 자사·이 프로젝트의 참여 건인가 (RLS + 명시 필터)
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id")
    .eq("id", engagementId)
    .eq("tenant_id", auth.tenantId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!engagement) {
    return { ok: false, error: "대상 참여 건을 찾을 수 없습니다." };
  }

  const fileName = readUploadFileName(formData, file);
  const validated = validateDocumentFile(file.type, fileName, file.size);
  if (!validated.ok) return { ok: false, error: validated.error };

  // 파일 1개 규칙 — 기존 건이 있으면 교체(삭제 후 업로드)
  const admin = createAdminClient();
  const { data: existing } = await supabase
    .from("settlement_line_attachments")
    .select("id, storage_path")
    .eq("engagement_id", engagementId)
    .maybeSingle();

  const ext = validated.extension;
  const storagePath = `settlement-attachments/${auth.tenantId}/${projectId}/${engagementId}-${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, bytes, { contentType: validated.contentType });
  if (uploadError) {
    return { ok: false, error: "파일 업로드에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  // 교체는 삭제-재삽입이 아니라 **행 update** — 중간 실패로 기존 증빙까지
  // 사라지는 창을 만들지 않는다 (리뷰 C-2). 구파일은 성공 뒤에 지운다.
  let writeError: { code?: string } | null = null;
  if (existing) {
    const { error } = await supabase
      .from("settlement_line_attachments")
      .update({
        file_name: fileName,
        storage_path: storagePath,
        mime_type: validated.contentType,
        file_size_bytes: file.size,
        uploaded_by: auth.userId,
      })
      .eq("id", existing.id);
    writeError = error;
    if (!error) {
      const { error: removeError } = await admin.storage
        .from(EXPERT_DOCUMENT_BUCKET)
        .remove([existing.storage_path]);
      if (removeError) {
        // 고아 파일 — 행은 새 파일을 가리키므로 기능은 정상. 흔적만 남긴다 (리뷰 C-4)
        console.warn("[settlement-attach] old file remove failed:", existing.storage_path);
      }
    }
  } else {
    const { error } = await supabase.from("settlement_line_attachments").insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      engagement_id: engagementId,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: validated.contentType,
      file_size_bytes: file.size,
      uploaded_by: auth.userId,
      is_practice: await isPracticeMode(),
    });
    writeError = error;
  }
  if (writeError) {
    // 행 기록 실패 — 올린 파일을 되돌린다 (고아 파일 방지)
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
    return {
      ok: false,
      error:
        writeError.code === "42P01"
          ? "증빙 첨부 기능이 아직 준비되지 않았습니다 (마이그레이션 미적용) — 캐스트로그에 알려 주세요."
          : writeError.code === "23505"
            ? "다른 담당자가 방금 이 건에 증빙을 첨부했습니다. 새로고침 후 확인해 주세요."
            : "첨부 기록에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "settlement_attachment.upload",
    resource_type: "expert_engagement",
    resource_id: engagementId,
    after_data: { file_name: fileName, size: file.size },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export async function deleteSettlementLineAttachment(
  attachmentId: string
): Promise<AttachResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const auth = await requireExecGrade("expertRecord");
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: row } = await supabase
    .from("settlement_line_attachments")
    .select("id, engagement_id, storage_path, file_name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "첨부를 찾을 수 없습니다." };

  const { error } = await supabase
    .from("settlement_line_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) return { ok: false, error: "첨부 삭제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

  {
    const { error: removeError } = await createAdminClient()
      .storage.from(EXPERT_DOCUMENT_BUCKET)
      .remove([row.storage_path]);
    if (removeError) {
      console.warn("[settlement-attach] file remove failed:", row.storage_path);
    }
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "settlement_attachment.delete",
    resource_type: "expert_engagement",
    resource_id: row.engagement_id,
    after_data: { file_name: row.file_name },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 증빙 열람 — 서명된 만료 URL (공개 URL 금지 §5). 열람도 감사에 남긴다.
 * 게이트: 등록 축(expertRecord) **또는 지급 검토 권한(canManagePayments)** —
 * 지급 근거를 검토하는 회계담당자(finance 위임)가 못 열면 모순이다 (리뷰 C-1).
 */
export async function getSettlementLineAttachmentUrl(
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewTenantId = tenantIdFromUser(user);
  const viewRole = roleFromUser(user);
  if (!user || !viewTenantId || !viewRole || viewRole === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  const [recordGate, paymentsGate] = await Promise.all([
    requireExecGrade("expertRecord"),
    canManagePayments(),
  ]);
  if (!recordGate.ok && !paymentsGate) {
    return {
      ok: false,
      error:
        "증빙 열람 권한이 없습니다 (권한 규칙 — 전문가 기록 축 또는 지급·정산 위임).",
    };
  }
  const auth = { tenantId: viewTenantId, userId: user.id, role: viewRole };
  const { data: row } = await supabase
    .from("settlement_line_attachments")
    .select("id, engagement_id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "첨부를 찾을 수 없습니다." };

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
    action: "settlement_attachment.view",
    resource_type: "expert_engagement",
    resource_id: row.engagement_id,
  });

  return { ok: true, url: signed.signedUrl };
}
