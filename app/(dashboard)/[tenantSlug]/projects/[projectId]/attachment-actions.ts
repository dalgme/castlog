"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantModules } from "@/lib/modules/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  EXPERT_DOCUMENT_BUCKET,
  validateDocumentFile,
} from "@/lib/experts/documents";

/**
 * 섭외요청·수락서에 동봉하는 첨부 (공통 / 개별).
 *
 * 공통 = 전원에게 같은 파일(사업 안내문·약도·주차 안내).
 * 개별 = 전문가 한 명에게만(개인 일정표·개별 안내).
 *
 * 저장은 기존 암호화 버킷을 쓰고 열람은 서명 만료 URL로만 한다. 민감서류는
 * 아니지만 전문가 개인에게 붙는 파일이 섞이므로 공개 URL을 만들지 않는다.
 */

const MANAGER_ROLES = ["org_admin", "manager"];

export type AttachmentResult = { ok: true } | { ok: false; error: string };

type Session = { userId: string; tenantId: string; role: string };

async function requireManager(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  // 섭외 첨부는 experts 모듈 소속 — 화면만 게이트하면 POST 직접 호출이 뚫린다(§1-2-3)
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
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "첨부 관리 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

export async function uploadProjectAttachment(
  formData: FormData
): Promise<AttachmentResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const projectId = String(formData.get("projectId") ?? "");
  const purpose = String(formData.get("purpose") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const expertIdRaw = String(formData.get("expertId") ?? "");
  const file = formData.get("file");

  if (!projectId) return { ok: false, error: "프로젝트를 확인하세요." };
  if (purpose !== "engagement" && purpose !== "acceptance") {
    return { ok: false, error: "첨부 용도를 확인하세요." };
  }
  if (scope !== "common" && scope !== "individual") {
    return { ok: false, error: "첨부 범위를 확인하세요." };
  }
  const expertId = scope === "individual" ? expertIdRaw : null;
  if (scope === "individual" && !expertId) {
    return { ok: false, error: "개별 첨부는 대상 전문가를 지정해야 합니다." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }

  // 용량·확장자는 서버에서 검증한다 (CLAUDE.md §12-5)
  const validation = validateDocumentFile(file.type, file.name, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

  const supabase = createClient();
  // 이 프로젝트를 볼 수 있는 사람만 — RLS가 판정한다
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const path = `project-attachments/${auth.session.tenantId}/${projectId}/${purpose}-${scope}-${crypto.randomUUID()}.${validation.extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "업로드에 실패했습니다." };

  const { error } = await supabase.from("project_engagement_attachments").insert({
    tenant_id: auth.session.tenantId,
    project_id: projectId,
    purpose,
    scope,
    expert_id: expertId,
    file_name: file.name,
    storage_path: path,
    mime_type: file.type,
    file_size_bytes: file.size,
    uploaded_by: auth.session.userId,
  });
  if (error) {
    // 행을 못 만들었으면 올린 파일도 지운다 — 주인 없는 파일을 남기지 않는다
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: "첨부 등록에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export async function deleteProjectAttachment(
  attachmentId: string
): Promise<AttachmentResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: row } = await supabase
    .from("project_engagement_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { ok: false, error: "첨부를 찾을 수 없습니다." };

  const { error } = await supabase
    .from("project_engagement_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  const admin = createAdminClient();
  await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([row.storage_path]);

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
