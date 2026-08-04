import "server-only";

import { randomUUID } from "crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import {
  isSmsTestMode,
  sendSms,
  type SmsCredentials,
  type SmsProviderKey,
} from "./providers";

/**
 * 테넌트 SMS 발송 서비스 (CLAUDE.md 5-1 — 발송 유형 분리는 법적 필수)
 *
 * 광고성(advertising) 서버 강제 사항:
 *  - 야간(21시~익일 8시 KST) 발송 차단
 *  - 광고 수신 미동의·수신거부자 자동 제외
 *  - "(광고)" 표기 + 무료수신거부 링크(/u) 자동 삽입 (제거 불가)
 * 업무연락(transactional)은 사전동의 불요 — 원문 그대로 발송.
 */

export type SmsRecipient = {
  phone: string; // E.164
  expertId: string | null;
  name: string;
};

export type SendSummary = {
  batchId: string;
  sent: number;
  failed: number;
  excluded: number; // 광고 미동의·수신거부 제외
  blocked: boolean; // 야간 차단으로 전체 미발송
  testMode: boolean;
};

/** KST 기준 야간(21:00~07:59) 여부 */
export function isNightTimeKst(now = new Date()): boolean {
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour >= 21 || kstHour < 8;
}

/** 광고 수신 가능 대상 필터 — 최신 동의 상태 granted + 수신거부 아님 */
async function filterAdConsented(
  tenantId: string,
  recipients: SmsRecipient[]
): Promise<{ allowed: SmsRecipient[]; excluded: SmsRecipient[] }> {
  const supabase = createClient();
  const expertIds = recipients
    .map((r) => r.expertId)
    .filter((id): id is string => id !== null);

  // 전문가별 최신 SMS 광고 수신동의 상태
  const { data: consents } =
    expertIds.length > 0
      ? await supabase
          .from("ad_consents")
          .select("expert_id, granted, created_at")
          .in("expert_id", expertIds)
          .eq("channel", "sms")
          .order("created_at", { ascending: true })
      : { data: [] };

  const latestGranted = new Map<string, boolean>();
  for (const consent of consents ?? []) {
    if (consent.expert_id) {
      latestGranted.set(consent.expert_id, consent.granted);
    }
  }

  // 테넌트 수신거부 목록
  const { data: unsubs } = await supabase
    .from("ad_unsubscribes")
    .select("phone")
    .eq("channel", "sms");
  const unsubscribed = new Set((unsubs ?? []).map((u) => u.phone).filter(Boolean));

  const allowed: SmsRecipient[] = [];
  const excluded: SmsRecipient[] = [];
  for (const recipient of recipients) {
    const consented =
      recipient.expertId !== null && latestGranted.get(recipient.expertId) === true;
    const isUnsubscribed = unsubscribed.has(recipient.phone);
    if (consented && !isUnsubscribed) {
      allowed.push(recipient);
    } else {
      excluded.push(recipient);
    }
  }
  return { allowed, excluded };
}

/** 수신거부 토큰 발급 (개인별) — 원문은 링크로만, DB에는 해시 저장 */
async function issueUnsubscribeLink(
  tenantId: string,
  recipient: SmsRecipient
): Promise<string> {
  const token = generateLinkToken();
  const admin = createAdminClient();
  await admin.from("unsubscribe_tokens").insert({
    token_hash: hashLinkToken(token),
    tenant_id: tenantId,
    channel: "sms",
    phone: recipient.phone,
    expert_id: recipient.expertId,
  });
  try {
    return buildPublicLink("unsubscribe", token);
  } catch {
    return `/u/${token}`;
  }
}

export type TenantSmsSendParams = {
  tenantId: string;
  senderUserId: string;
  messageType: "transactional" | "advertising";
  body: string;
  recipients: SmsRecipient[];
};

/** 테넌트 설정 조회 + 복호화 */
async function loadCredentials(): Promise<
  | { ok: true; creds: SmsCredentials; senderNumber: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const { data: config } = await supabase
    .from("tenant_sms_configs")
    .select("provider, api_key_encrypted, api_secret_encrypted, sender_number, is_active")
    .maybeSingle();

  if (!config || !config.is_active) {
    return {
      ok: false,
      error: "SMS 공급자가 설정되지 않았습니다. 설정 화면에서 자사 API 키를 등록하세요.",
    };
  }

  try {
    return {
      ok: true,
      creds: {
        provider: config.provider as SmsProviderKey,
        apiKey: decryptSecret(config.api_key_encrypted),
        apiSecret: config.api_secret_encrypted
          ? decryptSecret(config.api_secret_encrypted)
          : null,
      },
      senderNumber: config.sender_number,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "API 키 복호화에 실패했습니다.",
    };
  }
}

/** 발송 실행 — 전 건 sms_logs 기록 + 사용량 계측 */
export async function sendTenantSms(
  params: TenantSmsSendParams
): Promise<{ ok: true; summary: SendSummary } | { ok: false; error: string }> {
  const supabase = createClient();
  const batchId = randomUUID();
  const testMode = isSmsTestMode();

  // 광고성 — 야간 차단 (서버 강제)
  if (params.messageType === "advertising" && isNightTimeKst()) {
    return {
      ok: false,
      error: "광고성 문자는 야간(21시~익일 8시)에 발송할 수 없습니다 (법적 제한).",
    };
  }

  let targets = params.recipients;
  let excludedCount = 0;

  if (params.messageType === "advertising") {
    const { allowed, excluded } = await filterAdConsented(
      params.tenantId,
      params.recipients
    );
    targets = allowed;
    excludedCount = excluded.length;
    if (targets.length === 0) {
      return {
        ok: false,
        error: `발송 가능한 대상이 없습니다 (미동의·수신거부 ${excludedCount}명 제외).`,
      };
    }
  }

  const credsResult = testMode
    ? null // 테스트 모드는 공급자 설정 없이도 동작
    : await loadCredentials();
  if (credsResult && !credsResult.ok) return credsResult;

  let sent = 0;
  let failed = 0;

  for (const recipient of targets) {
    // 광고성: (광고) 표기 + 개인별 수신거부 링크 강제 삽입 (제거 불가)
    let finalBody = params.body;
    if (params.messageType === "advertising") {
      const unsubUrl = await issueUnsubscribeLink(params.tenantId, recipient);
      finalBody = `(광고) ${params.body}\n무료수신거부: ${unsubUrl}`;
    }

    const result = credsResult
      ? await sendSms(credsResult.creds, {
          to: recipient.phone,
          from: credsResult.senderNumber,
          text: finalBody,
        })
      : ({ ok: true, test: true } as const);

    const status = result.ok ? (result.test ? "test" : "sent") : "failed";
    if (result.ok) sent += 1;
    else failed += 1;

    await supabase.from("sms_logs").insert({
      tenant_id: params.tenantId,
      batch_id: batchId,
      message_type: params.messageType,
      recipient_phone: recipient.phone,
      recipient_expert_id: recipient.expertId,
      body: finalBody,
      status,
      provider: credsResult?.ok ? credsResult.creds.provider : "test",
      error_message: result.ok ? null : result.error,
      sent_by: params.senderUserId,
    });
  }

  // 사용량 계측 (설계문서 4.2 — 과금 없음, 계측만)
  if (sent > 0) {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data: metric } = await admin
      .from("tenant_usage_metrics")
      .select("id, sms_sent_count")
      .eq("tenant_id", params.tenantId)
      .eq("metric_date", today)
      .maybeSingle();
    if (metric) {
      await admin
        .from("tenant_usage_metrics")
        .update({ sms_sent_count: metric.sms_sent_count + sent })
        .eq("id", metric.id);
    } else {
      await admin.from("tenant_usage_metrics").insert({
        tenant_id: params.tenantId,
        metric_date: today,
        sms_sent_count: sent,
      });
    }
  }

  return {
    ok: true,
    summary: {
      batchId,
      sent,
      failed,
      excluded: excludedCount,
      blocked: false,
      testMode,
    },
  };
}
