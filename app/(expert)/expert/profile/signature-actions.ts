"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  EXPERT_DOCUMENT_BUCKET,
  MAX_SIGNATURE_BYTES,
  isSignatureCanvasType,
} from "@/lib/experts/documents";

export type SignatureActionResult = { ok: true } | { ok: false; error: string };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** 파일 시그니처(매직 바이트)로 실제 이미지 형식 판별 — 확장자·MIME 신고값은 믿지 않는다 */
function sniffImage(
  bytes: Buffer
): { mime: "image/png" | "image/jpeg"; extension: "png" | "jpg" } | null {
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSig.every((b, i) => bytes[i] === b)) {
    return { mime: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  return null;
}

/** 캔버스 PNG data URL → 바이트. 형식·용량 서버 검증 (CLAUDE.md 12-5). */
function decodePngDataUrl(
  dataUrl: string
): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, error: "서명 이미지 형식이 올바르지 않습니다." };
  }
  const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "서명 이미지를 해석할 수 없습니다." };
  }
  if (bytes.length === 0) {
    return { ok: false, error: "빈 서명은 저장할 수 없습니다." };
  }
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: "서명 이미지 용량이 너무 큽니다." };
  }
  if (sniffImage(bytes)?.mime !== "image/png") {
    return { ok: false, error: "PNG 서명 이미지만 저장할 수 있습니다." };
  }
  return { ok: true, bytes };
}

/**
 * 서명·날인 공통 저장 — 암호화 버킷 업로드 + expert_documents 등록.
 * 같은 유형의 기존 건은 'replaced'로 전환(이력 보존). 리사이즈하지 않는다.
 */
async function persistSignatureImage(
  kind: string,
  bytes: Buffer,
  mime: string,
  extension: string,
  fileName: string
): Promise<SignatureActionResult> {
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

  const storagePath = `${expert.id}/${kind}/${crypto.randomUUID()}.${extension}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mime,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: "서명 저장에 실패했습니다. 다시 시도해 주세요." };
  }

  const { data: previousDocs } = await supabase
    .from("expert_documents")
    .select("id")
    .eq("expert_id", expert.id)
    .eq("document_type", kind)
    .eq("status", "active");

  const { data: created, error: insertError } = await supabase
    .from("expert_documents")
    .insert({
      expert_id: expert.id,
      document_type: kind,
      storage_path: storagePath,
      file_name: fileName,
      file_size_bytes: bytes.length,
      mime_type: mime,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
    return { ok: false, error: "서명 등록에 실패했습니다. 다시 시도해 주세요." };
  }

  const replaced = (previousDocs?.length ?? 0) > 0;
  if (replaced) {
    await supabase
      .from("expert_documents")
      .update({ status: "replaced" })
      .in(
        "id",
        previousDocs!.map((d) => d.id)
      );
  }

  await supabase.from("expert_document_history").insert({
    document_id: created.id,
    expert_id: expert.id,
    action: replaced ? "replaced" : "created",
    actor_auth_user_id: user.id,
  });

  await supabase.from("audit_logs").insert({
    tenant_id: null, // 전문가 본인 행위 — 전역
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "expert_signature.register",
    resource_type: "expert_document",
    resource_id: created.id,
    after_data: { document_type: kind },
  });

  revalidatePath("/expert/profile");
  return { ok: true };
}

/**
 * 단계 28-A: 전문가 서명 등록 (캔버스 직접 서명 — 본인만).
 * 서명 캔버스가 만든 PNG를 암호화 버킷에 저장하고 expert_documents로 관리한다.
 */
export async function registerExpertSignature(
  kind: string,
  dataUrl: string
): Promise<SignatureActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!isSignatureCanvasType(kind)) {
    return { ok: false, error: "지원하지 않는 유형입니다." };
  }

  const decoded = decodePngDataUrl(dataUrl);
  if (!decoded.ok) return decoded;

  return persistSignatureImage(kind, decoded.bytes, "image/png", "png", `${kind}.png`);
}

/**
 * 서명·날인 이미지 파일 업로드 등록 (기획 확정 2026-08-22).
 * 서명은 직접 서명과 파일 업로드 겸용, 날인(도장)은 직접 찍을 수 없으니 업로드 전용.
 * PNG/JPG만 허용 — 매직 바이트로 실제 형식을 검증한다.
 */
export async function registerExpertSignatureUpload(
  kind: string,
  formData: FormData
): Promise<SignatureActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!isSignatureCanvasType(kind)) {
    return { ok: false, error: "지원하지 않는 유형입니다." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "이미지 파일을 선택하세요." };
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: "이미지 용량은 2MB 이하만 가능합니다." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return { ok: false, error: "PNG 또는 JPG 이미지만 등록할 수 있습니다." };
  }

  // 한글 파일명 보전 — 클라이언트가 보낸 원본 파일명 우선
  const clientFileName = formData.get("fileName");
  const fileName =
    typeof clientFileName === "string" && clientFileName.trim()
      ? clientFileName.trim()
      : `${kind}.${sniffed.extension}`;

  return persistSignatureImage(
    kind,
    bytes,
    sniffed.mime,
    sniffed.extension,
    fileName
  );
}
