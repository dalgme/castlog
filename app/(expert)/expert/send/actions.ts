"use server";

import { revalidatePath } from "next/cache";
import { readUploadFileName } from "@/lib/files/upload-name";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { resolveEmailProvider, type EmailAttachment } from "@/lib/email/provider";
import {
  DOCUMENT_TYPE_LABELS,
  EXPERT_DOCUMENT_BUCKET,
  isUploadableDocumentType,
  validateDocumentFile,
} from "@/lib/experts/documents";
import { SEND_EXPIRES_HOURS } from "@/lib/experts/external-send-constants";
import { SEND_STANDARD_TYPES } from "@/lib/experts/send-body-presets";

/** 클릭 시 임시 URL로 전달하는 표준 서류 유형(5종) */
const STANDARD_SEND_TYPES = SEND_STANDARD_TYPES.map((s) => s.type);
/** 외부 송신에서 다룰 수 있는 유형(표준 5종 + 일반 첨부) */
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
export type BodyPresetRow = { id: string; label: string; body: string };
export type SendContext = {
  /** 표준 5종(이력서·통장·신분증·명함·사업자등록증) 최신 문서 */
  standardDocs: ExternalDoc[];
  history: SendHistoryRow[];
  /** 보내는 사람 자동 채움값(전문가 본인). 발송 시 수정 가능. */
  senderName: string;
  senderEmail: string;
  /** 사용자 저장 본문 프리셋 */
  userPresets: BodyPresetRow[];
  /** 링크 유효 시간(시간) */
  expiresHours: number;
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
  const empty: SendContext = {
    standardDocs: [],
    history: [],
    senderName: "",
    senderEmail: "",
    userPresets: [],
    expiresHours: SEND_EXPIRES_HOURS,
  };
  if (!hasSupabaseEnv()) return empty;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return empty;
  const { data: expert } = await supabase
    .from("experts")
    .select("id, name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return empty;
  const expertId = expert.id;

  const [{ data: docs }, { data: sends }, { data: presets }] = await Promise.all([
    supabase
      .from("expert_documents")
      .select("id, document_type, file_name, created_at")
      .eq("expert_id", expertId)
      .eq("status", "active")
      .in("document_type", STANDARD_SEND_TYPES)
      .order("created_at", { ascending: false }),
    supabase
      .from("expert_external_sends")
      .select(
        "id, recipient_email, recipient_name, document_types, event_name, org_name, memo, sent_at, expires_at, status, opened_at"
      )
      .eq("expert_id", expertId)
      .order("sent_at", { ascending: false })
      .limit(100),
    supabase
      .from("expert_send_body_presets")
      .select("id, label, body")
      .eq("expert_id", expertId)
      .order("created_at", { ascending: false }),
  ]);

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

  return {
    standardDocs,
    history,
    senderName: expert.name ?? "",
    senderEmail: expert.email ?? user.email ?? "",
    userPresets: (presets ?? []).map((p) => ({ id: p.id, label: p.label, body: p.body })),
    expiresHours: SEND_EXPIRES_HOURS,
  };
}

export type UploadDocResult =
  | { ok: true; doc: ExternalDoc }
  | { ok: false; error: string };

/**
 * 외부 송신용 파일 업로드 — 생성된 문서를 반환(즉시 선택 가능).
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

  const fileName = readUploadFileName(formData, file);
  const validation = validateDocumentFile(file.type, fileName, file.size);
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

  const admin = createAdminClient();
  const storagePath = `${expertId}/${documentType}/${crypto.randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) return { ok: false, error: "파일 업로드에 실패했습니다." };

  const isStandard = STANDARD_SEND_TYPES.includes(documentType);
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
      file_name: fileName,
      file_size_bytes: file.size,
      mime_type: validation.contentType,
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
  | { ok: true; link: string | null; emailed: boolean; attachmentsSent: number }
  | { ok: false; error: string };

export async function sendExternalDocuments(input: {
  recipientEmail: string;
  recipientName?: string;
  senderName?: string;
  senderEmail?: string;
  /** 표준 서류(임시 URL로 전달) */
  documentIds: string[];
  /** 일반 첨부(실제 이메일 첨부, 만료 없음) */
  attachmentIds?: string[];
  body?: string;
  eventName?: string;
  orgName?: string;
  memo?: string;
}): Promise<SendResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const email = (input.recipientEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "받는 사람 이메일을 정확히 입력하세요." };
  }
  const senderName = (input.senderName ?? "").trim();
  const senderEmail = (input.senderEmail ?? "").trim();
  if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    return { ok: false, error: "보내는 사람 이메일 형식을 확인해 주세요." };
  }

  const docIds = Array.from(new Set((input.documentIds ?? []).filter(Boolean)));
  const attIds = Array.from(new Set((input.attachmentIds ?? []).filter(Boolean)));
  if (docIds.length === 0 && attIds.length === 0) {
    return { ok: false, error: "보낼 서류나 첨부파일을 1개 이상 선택하세요." };
  }

  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  // 선택 문서 검증(본인 소유·활성)
  const allIds = [...docIds, ...attIds];
  const { data: docs } = await supabase
    .from("expert_documents")
    .select("id, document_type, storage_path, file_name, mime_type")
    .eq("expert_id", expertId)
    .eq("status", "active")
    .in("id", allIds);
  const found = new Map((docs ?? []).map((d) => [d.id, d]));
  if (allIds.some((id) => !found.has(id))) {
    return { ok: false, error: "선택한 파일을 확인할 수 없습니다. 다시 시도해 주세요." };
  }

  const provider = resolveEmailProvider();
  const emailOn = Boolean(provider);

  // 이메일이 꺼져 있으면 첨부도 링크로 폴백(유실 방지). 켜져 있으면 실제 첨부로 전송.
  const linkIds = emailOn ? docIds : [...docIds, ...attIds];
  const linkTypes = linkIds.map((id) => found.get(id)!.document_type);

  const token = generateLinkToken();
  const expiresAt = new Date(Date.now() + SEND_EXPIRES_HOURS * 3600 * 1000);

  const { error } = await supabase.from("expert_external_sends").insert({
    expert_id: expertId,
    token_hash: hashLinkToken(token),
    recipient_email: email,
    recipient_name: input.recipientName?.trim() || null,
    document_ids: linkIds,
    document_types: linkTypes,
    event_name: input.eventName?.trim() || null,
    org_name: input.orgName?.trim() || null,
    memo: input.memo?.trim() || null,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { ok: false, error: "발송 기록 생성에 실패했습니다." };

  const link = linkIds.length > 0 ? buildPublicLink("externalSend", token) : null;

  // 실제 첨부 준비(이메일 켜진 경우만)
  let attachments: EmailAttachment[] = [];
  if (emailOn && attIds.length > 0) {
    const admin = createAdminClient();
    const built = await Promise.all(
      attIds.map(async (id) => {
        const d = found.get(id)!;
        const { data: blob } = await admin.storage
          .from(EXPERT_DOCUMENT_BUCKET)
          .download(d.storage_path);
        if (!blob) return null;
        const buf = Buffer.from(await blob.arrayBuffer());
        return {
          filename: d.file_name,
          content: buf.toString("base64"),
          contentType: d.mime_type ?? undefined,
        } as EmailAttachment;
      })
    );
    attachments = built.filter((a): a is EmailAttachment => Boolean(a));
  }

  // 본문 구성: 사용자 본문 + 시스템이 실제 링크를 덧붙임
  const userBody = (input.body ?? "").trim();
  const linkBlock = link
    ? `\n\n▶ 다운로드 링크\n${link}\n(위 링크는 ${SEND_EXPIRES_HOURS}시간 후 만료됩니다.)`
    : "";
  const text =
    (userBody ? userBody : "요청하신 서류를 보내드립니다.") + linkBlock + "\n";

  let emailed = false;
  if (provider) {
    const baseFrom = process.env.EMAIL_FROM ?? "CASTLOG <noreply@castlog.kr>";
    const fromAddress = baseFrom.includes("<")
      ? baseFrom.slice(baseFrom.indexOf("<"))
      : `<${baseFrom}>`;
    // 발신 주소는 인증 도메인(fromAddress)이어야 SPF/DKIM/DMARC를 통과한다.
    // 전문가 개인 주소를 발신 주소로 쓸 수는 없으므로, 수신자에게 보이는
    // '표시 이름'에 전문가 이름과 이메일을 넣고 Reply-To를 전문가로 지정한다.
    const displayName = senderName
      ? senderEmail
        ? `${senderName} (${senderEmail})`
        : senderName
      : "CASTLOG";
    const from = `${displayName} ${fromAddress}`;
    const result = await provider.send({
      from,
      to: email,
      replyTo: senderEmail || undefined,
      subject: `[서류 전달] ${input.eventName ? `${input.eventName} · ` : ""}${
        senderName ? `${senderName}님이 보낸 ` : ""
      }요청하신 서류입니다`,
      text,
      attachments: attachments.length ? attachments : undefined,
    });
    emailed = result.ok;
  }

  revalidatePath("/expert/send");
  return { ok: true, link, emailed, attachmentsSent: emailed ? attachments.length : 0 };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** 사용자 본문 프리셋 저장('사용자 옵션') */
export async function saveBodyPreset(
  label: string,
  body: string
): Promise<{ ok: true; preset: BodyPresetRow } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const trimmedBody = (body ?? "").trim();
  if (!trimmedBody) return { ok: false, error: "저장할 본문 내용을 입력하세요." };
  const trimmedLabel = (label ?? "").trim().slice(0, 40) || "사용자 옵션";

  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  const { data, error } = await supabase
    .from("expert_send_body_presets")
    .insert({ expert_id: expertId, label: trimmedLabel, body: trimmedBody })
    .select("id, label, body")
    .single();
  if (error || !data) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/expert/send");
  return { ok: true, preset: { id: data.id, label: data.label, body: data.body } };
}

export async function deleteBodyPreset(id: string): Promise<SimpleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_send_body_presets")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };
  revalidatePath("/expert/send");
  return { ok: true };
}

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
