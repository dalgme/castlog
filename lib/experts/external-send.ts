import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import { EXPERT_DOCUMENT_BUCKET, DOCUMENT_TYPE_LABELS } from "@/lib/experts/documents";

const DOWNLOAD_URL_EXPIRES_SECONDS = 300;

export type ResolvedSend = {
  id: string;
  expertId: string;
  documentIds: string[];
  documentTypes: string[];
  recipientName: string | null;
  eventName: string | null;
  expiresAt: string;
  expertName: string;
  items: { id: string; type: string; label: string }[];
};

/** 공개 토큰으로 발송 건 해석 — 만료·회수 검증 포함. 실패 시 null. */
export async function resolveExternalSend(
  token: string
): Promise<ResolvedSend | null> {
  const admin = createAdminClient();
  const { data: send } = await admin
    .from("expert_external_sends")
    .select(
      "id, expert_id, document_ids, document_types, recipient_name, event_name, expires_at, status"
    )
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();

  if (!send) return null;
  if (send.status === "revoked") return null;
  if (new Date(send.expires_at).getTime() < Date.now()) return null;

  const { data: expert } = await admin
    .from("experts")
    .select("name")
    .eq("id", send.expert_id)
    .maybeSingle();

  const items = (send.document_types ?? []).map((type, i) => ({
    id: (send.document_ids ?? [])[i] ?? "",
    type,
    label: DOCUMENT_TYPE_LABELS[type] ?? type,
  }));

  return {
    id: send.id,
    expertId: send.expert_id,
    documentIds: send.document_ids ?? [],
    documentTypes: send.document_types ?? [],
    recipientName: send.recipient_name,
    eventName: send.event_name,
    expiresAt: send.expires_at,
    expertName: expert?.name ?? "전문가",
    items: items.filter((it) => it.id),
  };
}

/** 최초 열람 기록 (수신 확인). */
export async function markSendOpened(id: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("expert_external_sends")
    .update({ opened_at: new Date().toISOString() })
    .eq("id", id)
    .is("opened_at", null);
}

/**
 * 토큰+문서 검증 후 만료 서명 다운로드 URL 발급.
 * 문서가 이 발송 건에 포함되고, 발송이 유효(만료·회수 아님)해야 한다.
 */
export async function issueExternalDownloadUrl(
  token: string,
  docId: string
): Promise<string | null> {
  const send = await resolveExternalSend(token);
  if (!send || !send.documentIds.includes(docId)) return null;

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("expert_documents")
    .select("storage_path, expert_id, status")
    .eq("id", docId)
    .maybeSingle();
  if (!doc || doc.expert_id !== send.expertId || doc.status !== "active") return null;

  const { data: signed } = await admin.storage
    .from(EXPERT_DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, DOWNLOAD_URL_EXPIRES_SECONDS);
  return signed?.signedUrl ?? null;
}
