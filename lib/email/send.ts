import "server-only";

import { randomUUID } from "crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { isPracticeMode } from "@/lib/practice/server";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { resolveEmailProvider } from "./provider";

/**
 * 이메일 발송 — 발송 정책(광고 필터·수신거부·로그·계측)은 여기, 실제 전송 수단은
 * lib/email/provider.ts 어댑터 뒤로 격리(BYO SMS 패턴). 기본 제공자는 Resend이며
 * 국내 데이터레지던시 교체는 EMAIL_PROVIDER 설정으로 처리한다
 * (docs/decisions/email-residency.md).
 *
 * 광고성 강제 사항 (CLAUDE.md 5-1):
 *  - 제목 "(광고)" 표기 + 본문 수신거부 링크(/u) 자동 삽입
 *  - 광고 수신 미동의(email 채널)·수신거부자 자동 제외
 *  - (야간 제한은 SMS 등 전화 매체 대상 — 이메일은 미적용)
 * 발송 제공자 미설정 시 테스트 모드(status 'test')로 기록만 한다.
 */

export type EmailRecipient = {
  email: string;
  expertId: string | null;
  name: string;
};

export type EmailSendParams = {
  tenantId: string;
  senderUserId: string;
  messageType: "transactional" | "advertising";
  subject: string;
  body: string;
  recipients: EmailRecipient[];
  /**
   * 답장 주소 — 발신은 인증 도메인(no-reply)이라 답장이 버려진다. 담당자
   * 주소를 넣어야 "이 메일에 회신"이 실제로 닿는다 (E2E 검수 전문가 P2-5)
   */
  replyTo?: string;
  /** HTML 본문(강조 표시). 없으면 평문만 — 2026-11-08 */
  html?: string;
  /** 이메일 대장 연결 (2026-11-08) — 프로젝트·섭외 건·용도. 컬럼 부재 DB에서는 버린다 */
  projectId?: string | null;
  engagementIds?: string[] | null;
  purpose?: string | null;
};

export type EmailSendSummary = {
  batchId: string;
  sent: number;
  failed: number;
  excluded: number;
  testMode: boolean;
};

async function filterAdConsentedEmail(
  recipients: EmailRecipient[]
): Promise<{ allowed: EmailRecipient[]; excludedCount: number }> {
  const supabase = createClient();
  const expertIds = recipients
    .map((r) => r.expertId)
    .filter((id): id is string => id !== null);

  const { data: consents } =
    expertIds.length > 0
      ? await supabase
          .from("ad_consents")
          .select("expert_id, granted, created_at")
          .in("expert_id", expertIds)
          .eq("channel", "email")
          .order("created_at", { ascending: true })
      : { data: [] };

  const latestGranted = new Map<string, boolean>();
  for (const consent of consents ?? []) {
    if (consent.expert_id) latestGranted.set(consent.expert_id, consent.granted);
  }

  const { data: unsubs } = await supabase
    .from("ad_unsubscribes")
    .select("email")
    .eq("channel", "email");
  const unsubscribed = new Set((unsubs ?? []).map((u) => u.email).filter(Boolean));

  const allowed = recipients.filter(
    (r) =>
      r.expertId !== null &&
      latestGranted.get(r.expertId) === true &&
      !unsubscribed.has(r.email)
  );
  return { allowed, excludedCount: recipients.length - allowed.length };
}

export async function sendTenantEmail(
  params: EmailSendParams
): Promise<
  { ok: true; summary: EmailSendSummary } | { ok: false; error: string }
> {
  const supabase = createClient();
  const admin = createAdminClient();
  const batchId = randomUUID();
  const provider = resolveEmailProvider();
  const baseFrom =
    process.env.EMAIL_FROM ??
    process.env.RESEND_FROM ??
    "CASTLOG <no-reply@castlog.kr>";
  // 발신자 표시 (기획 지시 2026-11-08): 수신함에 'CASTLOG'가 아니라 **그 회사와 보낸 직원**이 보여야 한다(§16).
  // 발신 **주소**는 인증 도메인(SPF/DKIM)이어야 하므로 env 주소를 그대로 쓰고, 표시 이름에
  // "회사명 · 담당자 이름 (담당자 이메일)"을 넣는다. 답장은 Reply-To로 담당자에게 간다.
  // 직원의 실제 주소를 발신 주소로 쓰려면 그 회사 도메인 인증이 필요하다 — 테넌트 도메인 작업(§1-1)에서.
  const fromAddressOnly = baseFrom.includes("<") ? baseFrom.slice(baseFrom.indexOf("<")) : `<${baseFrom}>`;
  const [{ data: senderRow }, { data: tenantRow }] = await Promise.all([
    admin.from("users").select("name, email").eq("id", params.senderUserId).maybeSingle(),
    admin.from("tenants").select("name").eq("id", params.tenantId).maybeSingle(),
  ]);
  const senderDisplay = senderRow?.name
    ? senderRow.email
      ? `${senderRow.name} (${senderRow.email})`
      : senderRow.name
    : null;
  const displayName = [tenantRow?.name ?? null, senderDisplay].filter(Boolean).join(" · ") || "CASTLOG";
  // 표시 이름의 따옴표·꺾쇠는 헤더를 깨뜨린다
  const safeDisplay = displayName.replace(/["<>\r\n]/g, " ").replace(/\s+/g, " ").trim();
  const fromAddress = `"${safeDisplay}" ${fromAddressOnly}`;
  const replyTo = params.replyTo ?? senderRow?.email ?? undefined;
  // 연습모드에서는 공급자 호출을 건너뛴다 (이력은 그대로 남는다).
  const testMode = !provider || (await isPracticeMode());

  let targets = params.recipients;
  let excludedCount = 0;

  if (params.messageType === "advertising") {
    const filtered = await filterAdConsentedEmail(params.recipients);
    targets = filtered.allowed;
    excludedCount = filtered.excludedCount;
    if (targets.length === 0) {
      return {
        ok: false,
        error: `발송 가능한 대상이 없습니다 (미동의·수신거부 ${excludedCount}명 제외).`,
      };
    }
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of targets) {
    let subject = params.subject;
    let body = params.body;

    if (params.messageType === "advertising") {
      const token = generateLinkToken();
      await admin.from("unsubscribe_tokens").insert({
        token_hash: hashLinkToken(token),
        tenant_id: params.tenantId,
        channel: "email",
        email: recipient.email,
        expert_id: recipient.expertId,
      });
      let unsubUrl: string;
      try {
        unsubUrl = buildPublicLink("unsubscribe", token);
      } catch {
        unsubUrl = `/u/${token}`;
      }
      subject = `(광고) ${params.subject}`;
      body = `${params.body}\n\n수신거부: ${unsubUrl}`;
    }

    let ok = true;
    let errorMessage: string | null = null;
    let providerMessageId: string | null = null;

    if (provider) {
      const result = await provider.send({
        from: fromAddress,
        to: recipient.email,
        subject,
        text: body,
        ...(params.html ? { html: params.html } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      if (!result.ok) {
        ok = false;
        errorMessage = result.error;
      } else {
        providerMessageId = result.id ?? null;
      }
    }

    if (ok) sent += 1;
    else failed += 1;

    const baseRow = {
      tenant_id: params.tenantId,
      batch_id: batchId,
      message_type: params.messageType,
      recipient_email: recipient.email,
      recipient_expert_id: recipient.expertId,
      subject,
      body,
      status: ok ? (testMode ? "test" : "sent") : "failed",
      error_message: errorMessage,
      sent_by: params.senderUserId,
    };
    // 이메일 대장 컬럼(0016) — 미적용 DB(PGRST204)에서는 종전 행으로 다시 기록한다 (§14-10)
    const { error: insertError } = await supabase.from("email_logs").insert({
      ...baseRow,
      project_id: params.projectId ?? null,
      engagement_ids: params.engagementIds ?? null,
      purpose: params.purpose ?? null,
      body_html: params.html ?? null,
      provider: provider?.id ?? null,
      provider_message_id: providerMessageId,
      delivery_status: ok && !testMode && providerMessageId ? "queued" : null,
    });
    if (insertError && isMissingColumnError(insertError)) {
      await supabase.from("email_logs").insert(baseRow);
    } else if (insertError) {
      // 자사 기록이 막히면(권한 등) service_role로 남긴다 — 발송 기록은 법적·운영 근거다
      await admin.from("email_logs").insert({
        ...baseRow,
        project_id: params.projectId ?? null,
        engagement_ids: params.engagementIds ?? null,
        purpose: params.purpose ?? null,
        body_html: params.html ?? null,
        provider: provider?.id ?? null,
        provider_message_id: providerMessageId,
        delivery_status: ok && !testMode && providerMessageId ? "queued" : null,
      });
    }
  }

  // 사용량 계측
  if (sent > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: metric } = await admin
      .from("tenant_usage_metrics")
      .select("id, email_sent_count")
      .eq("tenant_id", params.tenantId)
      .eq("metric_date", today)
      .maybeSingle();
    if (metric) {
      await admin
        .from("tenant_usage_metrics")
        .update({ email_sent_count: metric.email_sent_count + sent })
        .eq("id", metric.id);
    } else {
      await admin.from("tenant_usage_metrics").insert({
        tenant_id: params.tenantId,
        metric_date: today,
        email_sent_count: sent,
      });
    }
  }

  return {
    ok: true,
    summary: { batchId, sent, failed, excluded: excludedCount, testMode },
  };
}
