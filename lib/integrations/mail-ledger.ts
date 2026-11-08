import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/supabase/errors";
import type { MailLedgerData, MailLedgerRow } from "./mail-ledger-shared";

export { MAIL_DELIVERY_LABELS, MAIL_PURPOSE_LABELS, MAIL_SEND_STATUS_LABELS, type MailLedgerData, type MailLedgerRow } from "./mail-ledger-shared";

/**
 * 프로젝트 이메일 대장 (기획 지시 2026-11-08) — email_logs.project_id로 묶인 모든 메일.
 * 열람 범위는 email_logs RLS(자사 임직원)와 프로젝트 열람(이 탭에 들어온 사람)이 정한다.
 */
export async function loadProjectMailLedger(projectId: string): Promise<MailLedgerData> {
  const supabase = createClient();
  const providerConfigured = Boolean(process.env.RESEND_API_KEY) && (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase() === "resend";
  const webhookConfigured = Boolean(process.env.RESEND_WEBHOOK_SECRET);
  const { data, error } = await supabase
    .from("email_logs")
    .select(
      "id, created_at, sent_by, recipient_email, recipient_expert_id, purpose, subject, body, body_html, status, error_message, delivery_status, delivered_at, opened_at, bounced_at, delivery_detail, engagement_ids, provider_message_id, provider"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    if (isMissingColumnError(error)) return { ready: false, rows: [], webhookConfigured, providerConfigured };
    return { ready: true, rows: [], webhookConfigured, providerConfigured };
  }
  const rows = data ?? [];
  const userIds = Array.from(new Set(rows.map((r) => r.sent_by).filter((v): v is string => Boolean(v))));
  const expertIds = Array.from(new Set(rows.map((r) => r.recipient_expert_id).filter((v): v is string => Boolean(v))));
  const [{ data: users }, { data: experts }] = await Promise.all([
    userIds.length > 0 ? supabase.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    expertIds.length > 0 ? supabase.from("experts").select("id, name").in("id", expertIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const expertName = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const mapped: MailLedgerRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    senderName: r.sent_by ? userName.get(r.sent_by) ?? null : null,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_expert_id ? expertName.get(r.recipient_expert_id) ?? null : null,
    purpose: r.purpose ?? "general",
    subject: r.subject,
    body: r.body,
    bodyHtml: r.body_html,
    sendStatus: r.status,
    errorMessage: r.error_message,
    deliveryStatus: r.delivery_status,
    deliveredAt: r.delivered_at,
    openedAt: r.opened_at,
    bouncedAt: r.bounced_at,
    deliveryDetail: r.delivery_detail,
    engagementIds: r.engagement_ids ?? [],
    trackable: Boolean(r.provider_message_id),
    provider: r.provider,
  }));
  return { ready: true, rows: mapped, webhookConfigured, providerConfigured };
}
