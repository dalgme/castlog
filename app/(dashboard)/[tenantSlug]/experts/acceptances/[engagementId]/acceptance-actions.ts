"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";
import { notifyExpert } from "@/lib/experts/notifications";

export type AcceptanceActionResult = { ok: true } | { ok: false; error: string };

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireManager(): Promise<
  { ok: true; userId: string; tenantId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "수락서 편집 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, userId: user.id, tenantId };
}

/** 수락서 보완 편집 — 상세 설명(안내문). 조건 스냅샷은 변경하지 않는다. */
export async function updateAcceptanceGuide(
  acceptanceId: string,
  guideNote: string
): Promise<AcceptanceActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (guideNote.length > 3000) {
    return { ok: false, error: "상세 설명은 3000자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("engagement_acceptances")
    .update({ guide_note: guideNote.trim() || null })
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
      contentType: file.type,
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
      contentType: file.type,
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

  await notifyExpert({
    expertId: acceptance.expert_id,
    category: "engagement_request",
    title: "수락서가 도착했습니다 — 확인 및 서명이 필요합니다",
    body: acceptance.program_name ?? acceptance.project_name ?? undefined,
    link: `/expert/engagements/${acceptance.engagement_id}/acceptance`,
    tenantId: auth.tenantId,
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
