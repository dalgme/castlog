"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { resolveEmailProvider } from "@/lib/email/provider";
import {
  DOCUMENT_TYPE_LABELS,
  EXPERT_DOCUMENT_BUCKET,
  isUploadableDocumentType,
  validateDocumentFile,
} from "@/lib/experts/documents";

const SEND_EXPIRES_HOURS = 72;

/** 외부 송신 버튼으로 다룰 표준 서류 유형(이미 업로드된 임시 URL을 전달) */
const STANDARD_SEND_TYPES = ["resume", "id_card_copy", "bank_account_copy"] as const;
/** 외부 송신에서 첨부 가능한 유형(표준 3종 + 일반 첨부) */
const SENDABLE_TYPES: readonly string[] = [...STANDARD_SEND_TYPES, "attachment"];

export type ExternalDoc = { id: string; type: string; label: string; fileName: string };
export type SendHistoryRow = {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  documentTypes: string[];
  eventName: string | null;
  orgName: string | null;
  memo: string | null;
  sentAt: string;
  expiresAt: string;
  status: string;
  openedAt: string | null;
  link: string | null;
};
export type SendContext = {
  /** 표준 3종(이력서·통장·신분증) 최신 문서 — 없으면 해당 키 없음 */
  standardDocs: ExternalDoc[];
  history: SendHistoryRow[];
};

async function currentExpertId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return expert?.id ?? null;
}

export async function getSendContext(): Promise<SendContext> {
  if (!hasSupabaseEnv()) return { standardDocs: [], history: [] };
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { standardDocs: [], history: [] };

  const [{ data: docs }, { data: sends }] = await Promise.all([
    supabase
      .from("expert_documents")
      .select("id, document_type, file_name, created_at")
      .eq("expert_id", expertId)
      .eq("status", "active")
      .in("document_type", [...STANDARD_SEND_TYPES])
      .order("created_at", { ascending: false }),
    supabase
      .from("expert_external_sends")
      .select(
        "id, recipient_email, recipient_name, document_types, event_name, org_name, memo, sent_at, expires_at, status, opened_at"
      )
      .eq("expert_id", expertId)
      .order("sent_at", { ascending: false })
      .limit(100),
  ]);

  // 유형별 최신 1개
  const byType = new Map<string, ExternalDoc>();
  for (const d of docs ?? []) {
    if (!byType.has(d.document_type)) {
      byType.set(d.document_type, {
        id: d.id,
        type: d.document_type,
        label: DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type,
        fileName: d.file_name,
      });
    }
  }
  const standardDocs = STANDARD_SEND_TYPES.map((t) => byType.get(t)).filter(
    (d): d is ExternalDoc => Boolean(d)
  );

  const history: SendHistoryRow[] = (sends ?? []).map((s) => ({
    id: s.id,
    recipientEmail: s.recipient_email,
    recipientName: s.recipient_name,
    documentTypes: s.document_types,
    eventName: s.event_name,
    orgName: s.org_name,
    memo: s.memo,
    sentAt: s.sent_at,
    expiresAt: s.expires_at,
    status: s.status,
    openedAt: s.opened_at,
    link: null,
  }));

  return { standardDocs, history };
}

export type UploadDocResult =
  | { ok: true; doc: ExternalDoc }
  | { ok: false; error: string };

/**
 * 외부 송신용 파일 업로드 — 업로드 후 생성된 문서를 반환(즉시 선택 가능).
 * 표준 유형(미등록 시 여기서 업로드)과 일반 첨부(attachment) 모두 처리.
 */
export async function uploadSendFile(formData: FormData): Promise<UploadDocResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const documentType = String(formData.get("documentType") ?? "");
  const file = formData.get("file");
  if (!SENDABLE_TYPES.includes(documentType) || !isUploadableDocumentType(documentType)) {
    return { ok: false, error: "지원하지 않는 첨부 유형입니다." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택해 주세요." };
  }

  const validation = validateDocumentFile(file.type, file.name, file.size);
  if (!validation.ok) return { ok: false, error: validation.error };

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
  const expertId = expert.id;

  // 스토리지 접근은 service_role 전용(암호화 버킷).
  const admin = createAdminClient();
  const storagePath = `${expertId}/${documentType}/${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "파일 업로드에 실패했습니다." };

  // 표준 유형은 기존 활성 서류를 replaced 처리(이력 보존). 일반 첨부는 누적.
  const isStandard = (STANDARD_SEND_TYPES as readonly string[]).includes(documentType);
  let previousActive: { id: string }[] = [];
  if (isStandard) {
    const { data } = await supabase
      .from("expert_documents")
      .select("id")
      .eq("expert_id", expertId)
      .eq("document_type", documentType)
      .eq("status", "active");
    previousActive = data ?? [];
  }

  const { data: created, error: insertError } = await supabase
    .from("expert_documents")
    .insert({
      expert_id: expertId,
      document_type: documentType,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
    })
    .select("id, document_type, file_name")
    .single();
  if (insertError || !created) {
    await admin.storage.from(EXPERT_DOCUMENT_BUCKET).remove([storagePath]);
    return { ok: false, error: "문서 등록에 실패했습니다." };
  }

  if (previousActive.length > 0) {
    await supabase
      .from("expert_documents")
      .update({ status: "replaced" })
      .in(
        "id",
        previousActive.map((d) => d.id)
      );
  }

  await supabase.from("expert_document_history").insert({
    document_id: created.id,
    expert_id: expertId,
    action: previousActive.length > 0 ? "replaced" : "created",
    actor_auth_user_id: user.id,
  });

  await supabase.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "expert_document.upload",
    resource_type: "expert_document",
    resource_id: created.id,
    after_data: { document_type: documentType, via: "external_send" },
  });

  revalidatePath("/expert/send");
  revalidatePath("/expert/documents");
  return {
    ok: true,
    doc: {
      id: created.id,
      type: created.document_type,
      label: DOCUMENT_TYPE_LABELS[created.document_type] ?? created.document_type,
      fileName: created.file_name,
    },
  };
}

export type SendResult =
  | { ok: true; link: string; emailed: boolean }
  | { ok: false; error: string };

export async function sendExternalDocuments(input: {
  recipientEmail: string;
  recipientName?: string;
  documentIds: string[];
  eventName?: string;
  orgName?: string;
  memo?: string;
}): Promise<SendResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const email = (input.recipientEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "받는 사람 이메일을 정확히 입력하세요." };
  }
  const ids = Array.from(new Set((input.documentIds ?? []).filter(Boolean)));
  if (ids.length === 0) {
    return { ok: false, error: "보낼 서류를 1개 이상 선택하세요." };
  }

  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  // 선택 문서 검증(본인 소유·활성·전송 가능 유형)
  const { data: docs } = await supabase
    .from("expert_documents")
    .select("id, document_type")
    .eq("expert_id", expertId)
    .eq("status", "active")
    .in("id", ids);
  const found = new Map((docs ?? []).map((d) => [d.id, d.document_type]));
  const invalid = ids.filter(
    (id) => !found.has(id) || !SENDABLE_TYPES.includes(found.get(id)!)
  );
  if (invalid.length > 0) {
    return { ok: false, error: "선택한 서류를 확인할 수 없습니다. 다시 시도해 주세요." };
  }

  const orderedIds = ids;
  const types = orderedIds.map((id) => found.get(id)!);

  const token = generateLinkToken();
  const expiresAt = new Date(Date.now() + SEND_EXPIRES_HOURS * 3600 * 1000);

  const { error } = await supabase.from("expert_external_sends").insert({
    expert_id: expertId,
    token_hash: hashLinkToken(token),
    recipient_email: email,
    recipient_name: input.recipientName?.trim() || null,
    document_ids: orderedIds,
    document_types: types,
    event_name: input.eventName?.trim() || null,
    org_name: input.orgName?.trim() || null,
    memo: input.memo?.trim() || null,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { ok: false, error: "발송 기록 생성에 실패했습니다." };

  const link = buildPublicLink("externalSend", token);
  const typeLabels = types.map((t) => DOCUMENT_TYPE_LABELS[t] ?? t).join(", ");

  // 이메일 발송(플랫폼 경로). 미구성(테스트 모드)이면 링크만 반환.
  let emailed = false;
  const provider = resolveEmailProvider();
  if (provider) {
    const from = process.env.EMAIL_FROM ?? "CASTLOG <noreply@castlog.kr>";
    const result = await provider.send({
      from,
      to: email,
      subject: `[서류 전달] ${input.eventName ? `${input.eventName} · ` : ""}요청하신 서류입니다`,
      text:
        `안녕하세요${input.recipientName ? ` ${input.recipientName}님` : ""},\n\n` +
        `요청하신 서류(${typeLabels})를 안전한 다운로드 링크로 보내드립니다.\n` +
        `아래 링크에서 ${SEND_EXPIRES_HOURS}시간 이내에 다운로드해 주세요.\n\n` +
        `${link}\n\n` +
        `이 링크는 만료 후 사용할 수 없으며, 보안을 위해 발신자가 회수할 수 있습니다.\n`,
    });
    emailed = result.ok;
  }

  revalidatePath("/expert/send");
  return { ok: true, link, emailed };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function updateSendMemo(
  id: string,
  fields: { eventName?: string; orgName?: string; memo?: string }
): Promise<SimpleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_external_sends")
    .update({
      event_name: fields.eventName?.trim() || null,
      org_name: fields.orgName?.trim() || null,
      memo: fields.memo?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: "메모 저장에 실패했습니다." };
  revalidatePath("/expert/send");
  return { ok: true };
}

/** 회수 — 즉시 만료 처리(링크 무효화). */
export async function revokeSend(id: string): Promise<SimpleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_external_sends")
    .update({ status: "revoked" })
    .eq("id", id);
  if (error) return { ok: false, error: "회수에 실패했습니다." };
  revalidatePath("/expert/send");
  return { ok: true };
}
