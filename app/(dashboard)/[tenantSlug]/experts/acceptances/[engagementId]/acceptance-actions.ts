"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantModules } from "@/lib/modules/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { canExec, execDeniedMessage } from "@/lib/auth/exec-permissions";
import { gradeFromUser } from "@/lib/auth/tenant";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";
import { notifyExpert } from "@/lib/experts/notifications";
import {
  sendEngagementEmail,
  portalUrl,
} from "@/lib/integrations/engagement-email";

export type AcceptanceActionResult = { ok: true } | { ok: false; error: string };


async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  // 수락서는 experts 모듈 소속 — 화면만 게이트하면 POST 직접 호출이 뚫린다(§1-2-3)
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 섭외 기능을 사용하지 않는 회사입니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!canExec("acceptanceSend", gradeFromUser(user), role)) {
    return { ok: false, error: execDeniedMessage("acceptanceSend") };
  }
  return { ok: true, userId: user.id, tenantId };
}

/**
 * 수락서 보완 편집 — 안내문 + 지급 안내(입금예정·제출서류).
 * 조건 스냅샷(역할·비용·일정)과 지급 계좌·소득구분 스냅샷은 변경하지 않는다.
 */
export async function updateAcceptanceGuide(
  acceptanceId: string,
  guideNote: string,
  paymentDueNote?: string,
  submissionDocs?: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (guideNote.length > 3000) {
    return { ok: false, error: "상세 설명은 3000자 이내로 입력하세요." };
  }
  if ((paymentDueNote ?? "").length > 200 || (submissionDocs ?? "").length > 500) {
    return { ok: false, error: "지급 안내 문구가 너무 깁니다." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_acceptances")
    .update({
      guide_note: guideNote.trim() || null,
      payment_due_note: paymentDueNote?.trim() || null,
      submission_docs: submissionDocs?.trim() || null,
    })
    .eq("id", acceptanceId);
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 찾아오는 길(약도) 이미지 등록 — 암호화 버킷, 서명 URL로만 열람. */
export async function uploadAcceptanceMap(
  formData: FormData
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const acceptanceId = String(formData.get("acceptanceId") ?? "");
  const file = formData.get("file");
  if (!acceptanceId) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "이미지를 선택해 주세요." };
  }
  const validation = validateDocumentFile(file.type, file.name, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

  const admin = createAdminClient();
  const path = `acceptances/${auth.tenantId}/${acceptanceId}-map-${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다." };

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_acceptances")
    .update({ map_image_path: path })
    .eq("id", acceptanceId);
  if (error) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "저장에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 수락서 첨부파일 등록 (동봉 자료). */
export async function uploadAcceptanceAttachment(
  formData: FormData
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const acceptanceId = String(formData.get("acceptanceId") ?? "");
  const file = formData.get("file");
  if (!acceptanceId) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택해 주세요." };
  }
  const validation = validateDocumentFile(file.type, file.name, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

  const admin = createAdminClient();
  const path = `acceptances/${auth.tenantId}/${acceptanceId}-att-${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다." };

  const supabase = createClient();
  const { error } = await supabase.from("engagement_acceptance_attachments").insert({
    tenant_id: auth.tenantId,
    acceptance_id: acceptanceId,
    file_name: file.name,
    storage_path: path,
    mime_type: file.type,
    file_size_bytes: file.size,
    uploaded_by: auth.userId,
  });
  if (error) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "저장에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 첨부 삭제 */
export async function deleteAcceptanceAttachment(
  attachmentId: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: row } = await supabase
    .from("engagement_acceptance_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();

  const { error } = await supabase
    .from("engagement_acceptance_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  if (row?.storage_path) {
    const admin = createAdminClient();
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([row.storage_path]);
  }

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 수락서 송부 — 전문가에게 확인·서명 요청 알림. */
export async function sendAcceptance(
  acceptanceId: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: acceptance } = await supabase
    .from("engagement_acceptances")
    .select("id, engagement_id, expert_id, status, tenant_name, program_name, project_name")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: "수락서를 찾을 수 없습니다." };
  if (acceptance.status === "confirmed") {
    return { ok: false, error: "이미 확인이 완료된 수락서입니다." };
  }

  const { error } = await supabase
    .from("engagement_acceptances")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", acceptanceId);
  if (error) return { ok: false, error: "송부 처리에 실패했습니다." };

  const letterPath = `/expert/engagements/${acceptance.engagement_id}/acceptance`;

  await notifyExpert({
    expertId: acceptance.expert_id,
    category: "engagement_request",
    title: "수락서가 도착했습니다 — 확인 및 서명이 필요합니다",
    body: acceptance.program_name ?? acceptance.project_name ?? undefined,
    link: letterPath,
    tenantId: auth.tenantId,
  });

  // 업무연락 메일 — 수락서 확인·서명 요청
  const title = acceptance.program_name ?? acceptance.project_name ?? "섭외";
  await sendEngagementEmail({
    tenantId: auth.tenantId,
    senderUserId: auth.userId,
    expertId: acceptance.expert_id,
    subject: `[수락서] ${title} — 확인 및 서명 요청`,
    body:
      `${acceptance.tenant_name}에서 수락서를 보내드립니다.\n\n` +
      `아래 링크에서 내용을 확인하시고 전자서명을 완료해 주세요.\n` +
      `${portalUrl(letterPath)}\n\n` +
      `※ 포털 로그인 후 확인하실 수 있습니다.\n`,
  });

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}

/** 기업담당자 최종 확인 — 전문가 서명본 접수 확인. */
export async function confirmAcceptance(
  acceptanceId: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: acceptance } = await supabase
    .from("engagement_acceptances")
    .select("id, status")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: "수락서를 찾을 수 없습니다." };
  if (acceptance.status !== "signed") {
    return { ok: false, error: "전문가 서명이 완료된 후 확인할 수 있습니다." };
  }

  const { error } = await supabase
    .from("engagement_acceptances")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: auth.userId,
    })
    .eq("id", acceptanceId);
  if (error) return { ok: false, error: "확인 처리에 실패했습니다." };

  revalidatePath("/[tenantSlug]/experts/acceptances/[engagementId]", "page");
  return { ok: true };
}
