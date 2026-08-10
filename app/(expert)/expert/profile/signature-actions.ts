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
  // PNG 시그니처 확인 (89 50 4E 47 0D 0A 1A 0A)
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) {
    return { ok: false, error: "PNG 서명 이미지만 저장할 수 있습니다." };
  }
  return { ok: true, bytes };
}

/**
 * 단계 28-A: 전문가 서명·날인 등록 (본인만).
 * 서명 캔버스가 만든 PNG를 암호화 버킷에 저장하고 expert_documents로 관리한다.
 * 같은 유형의 기존 서명은 'replaced'로 전환(이력 보존). 리사이즈하지 않는다.
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

  const storagePath = `${expert.id}/${kind}/${crypto.randomUUID()}.png`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, decoded.bytes, {
      contentType: "image/png",
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
      file_name: `${kind}.png`,
      file_size_bytes: decoded.bytes.length,
      mime_type: "image/png",
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
