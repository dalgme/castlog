"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { resolveEmailProvider } from "@/lib/email/provider";
import { DOCUMENT_TYPE_LABELS } from "@/lib/experts/documents";

const SEND_EXPIRES_HOURS = 72;

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
export type SendContext = { documents: ExternalDoc[]; history: SendHistoryRow[] };

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
  if (!hasSupabaseEnv()) return { documents: [], history: [] };
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { documents: [], history: [] };

  const [{ data: docs }, { data: sends }] = await Promise.all([
    supabase
      .from("expert_documents")
      .select("id, document_type, file_name")
      .eq("expert_id", expertId)
      .eq("status", "active")
      .in("document_type", ["resume", "id_card_copy", "bank_account_copy"]),
    supabase
      .from("expert_external_sends")
      .select(
        "id, recipient_email, recipient_name, document_types, event_name, org_name, memo, sent_at, expires_at, status, opened_at"
      )
      .eq("expert_id", expertId)
      .order("sent_at", { ascending: false })
      .limit(100),
  ]);

  // 최신 문서만(타입별 1개)
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

  return { documents: Array.from(byType.values()), history };
}

export type SendResult =
  | { ok: true; link: string; emailed: boolean }
  | { ok: false; error: string };

export async function sendExternalDocuments(input: {
  recipientEmail: string;
  recipientName?: string;
  documentTypes: string[];
  eventName?: string;
  orgName?: string;
  memo?: string;
}): Promise<SendResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const email = (input.recipientEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "받는 사람 이메일을 정확히 입력하세요." };
  }
  const types = (input.documentTypes ?? []).filter((t) =>
    ["resume", "id_card_copy", "bank_account_copy"].includes(t)
  );
  if (types.length === 0) {
    return { ok: false, error: "보낼 서류를 1개 이상 선택하세요." };
  }

  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  // 선택한 타입의 활성 문서 스냅샷
  const { data: docs } = await supabase
    .from("expert_documents")
    .select("id, document_type")
    .eq("expert_id", expertId)
    .eq("status", "active")
    .in("document_type", types);
  const chosen = new Map<string, string>();
  for (const d of docs ?? []) if (!chosen.has(d.document_type)) chosen.set(d.document_type, d.id);
  const missing = types.filter((t) => !chosen.has(t));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `등록되지 않은 서류가 있습니다: ${missing
        .map((t) => DOCUMENT_TYPE_LABELS[t] ?? t)
        .join(", ")}`,
    };
  }

  const token = generateLinkToken();
  const expiresAt = new Date(Date.now() + SEND_EXPIRES_HOURS * 3600 * 1000);

  const { error } = await supabase.from("expert_external_sends").insert({
    expert_id: expertId,
    token_hash: hashLinkToken(token),
    recipient_email: email,
    recipient_name: input.recipientName?.trim() || null,
    document_ids: types.map((t) => chosen.get(t)!),
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
