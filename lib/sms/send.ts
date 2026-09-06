import "server-only";

import { randomUUID } from "crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingColumnError } from "@/lib/supabase/errors";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { decryptSecret } from "@/lib/crypto/secrets";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { isPracticeMode } from "@/lib/practice/server";
import {
  isSmsTestMode,
  sendSms,
  uploadMmsImage,
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
  // 동의 상태도 service_role로 읽는다 — 보내는 직원의 RLS에 걸려 비어 보이면
  // 전원이 '미동의'로 잘못 제외된다. 대상은 아래 expert_id·phone으로 한정한다
  const supabase = createAdminClient();
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
  senderUserId: string | null;
  messageType: "transactional" | "advertising";
  body: string;
  recipients: SmsRecipient[];
  /**
   * 발신번호 지정 (기획 확정 2026-08-22 — 발신번호 다중 등록).
   * 등록된 번호(대표번호 + tenant_sms_senders)만 허용 — 목록에 없으면 무시하고
   * 기본 규칙으로 떨어진다: 보내는 직원 본인의 휴대폰과 일치하는 등록 번호가
   * 있으면 그 번호, 없으면 회사 대표번호.
   */
  senderNumber?: string | null;
  /**
   * 세션이 없는 실행 경로(예약 발송 크론)에서 true. 설정 조회·로그 기록을
   * service_role로 수행한다. 화면에서 호출할 때는 지정하지 않는다.
   */
  systemContext?: boolean;
  /**
   * 발송 건(sms_send_batches) id를 미리 만들어 로그와 연결할 때 지정
   * (기획 확정 2026-08-23 — 발송 이력·제목·예약). 미지정 시 임의 생성.
   */
  batchId?: string | null;
  /** MMS 이미지 id (기획 확정 2026-08-23) — uploadTenantMmsImage로 발급 */
  imageId?: string | null;
  /**
   * 이 문자가 담은 섭외 건 id (기획 지시 2026-09-05) — 섭외 진행 탭의
   * 멘토별 발송 이력·재발송이 이 연결로 판정한다. 묶음 발송은 여러 건.
   */
  engagementIds?: string[] | null;
};

/**
 * sms_logs 기록 — engagement_ids 컬럼이 아직 없는 DB(SQL 먼저, §14-10)에서는
 * 연결 없이 기록한다. 기록 실패가 발송을 막지는 않는다.
 */
async function insertSmsLog(
  admin: ReturnType<typeof createAdminClient>,
  rows: TablesInsert<"sms_logs">[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from("sms_logs").insert(rows);
  if (error && isMissingColumnError(error)) {
    const { error: retryError } = await admin.from("sms_logs").insert(
      rows.map((r) => {
        const { engagement_ids: _omit, ...rest } = r;
        void _omit;
        return rest;
      })
    );
    if (retryError) console.error("[sms] log insert failed:", retryError.code);
  } else if (error) {
    console.error("[sms] log insert failed:", error.code);
  }
}

/**
 * 테넌트 설정 조회 + 자격증명 해석.
 *
 * 발송 방식이 둘이다 (CLAUDE.md 5-2 개정):
 *  - byo      — 자사 공급자 계정. 암호화 저장된 자사 키를 복호화해 쓴다.
 *  - platform — 캐스트로그(넥스트랩) 솔라피 계정. 자격증명은 서버 환경변수에만
 *               있고 DB에는 저장하지 않는다 — 테넌트 행이 탈취돼도 플랫폼 키는
 *               나가지 않는다. 발신번호는 **그 기업의 번호**를 그대로 쓴다
 *               (캐스트로그 솔라피 계정에 사전등록된 번호여야 발송이 통과된다).
 */
async function loadCredentials(
  tenantId: string,
  systemContext: boolean
): Promise<
  | { ok: true; creds: SmsCredentials; senderNumber: string }
  | { ok: false; error: string }
> {
  // 공급자 설정은 항상 service_role로 읽는다 — tenant_sms_configs의 RLS는
  // "설정을 관리할 수 있는 사람"(대표·sending 위임자) 기준이라, 대리·주임이
  // 섭외요청·수락서 문자를 보내면 설정 행이 안 보여 "설정되지 않았습니다"로
  // 조용히 떨어졌다 (렛츠 보고 2026-09-05 — 문자 미수신). 보낼 자격은 호출한
  // 액션의 실행 게이트(engagementRequest 등)가 이미 판정했고, 키는 서버 안에서
  // 복호화돼 공급자 호출에만 쓰인다. service_role은 RLS가 걸리지 않으므로
  // tenant_id를 반드시 명시한다.
  void systemContext;
  const supabase = createAdminClient();
  let config:
    | {
        provider: string;
        mode: string;
        api_key_encrypted: string | null;
        api_secret_encrypted: string | null;
        sender_number: string;
        is_active: boolean;
        platform_access_granted_at: string | null;
      }
    | null = null;
  const full = await supabase
    .from("tenant_sms_configs")
    .select(
      "provider, mode, api_key_encrypted, api_secret_encrypted, sender_number, is_active, platform_access_granted_at"
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (full.error && isMissingColumnError(full.error)) {
    // mode 컬럼은 보류 중인 b(캐스트로그 발송) 마이그레이션 소속이다.
    // 그 마이그레이션이 아직 적용되지 않은 DB에서 **기존 자사 발송이 죽으면
    // 안 된다** — 구버전 스키마로 재조회하고 전부 byo로 간주한다.
    const legacy = await supabase
      .from("tenant_sms_configs")
      .select(
        "provider, api_key_encrypted, api_secret_encrypted, sender_number, is_active"
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    config = legacy.data
      ? { ...legacy.data, mode: "byo", platform_access_granted_at: null }
      : null;
  } else {
    config = full.data;
  }

  if (!config || !config.is_active) {
    return {
      ok: false,
      error:
        "SMS 발송이 설정되지 않았습니다. 설정 화면에서 자사 API 키를 등록하거나 캐스트로그 발송을 신청하세요.",
    };
  }

  if (config.mode === "platform") {
    if (!config.platform_access_granted_at) {
      return {
        ok: false,
        error: "캐스트로그 발송 이용이 아직 승인되지 않았습니다.",
      };
    }
    const apiKey = process.env.PLATFORM_SOLAPI_API_KEY;
    const apiSecret = process.env.PLATFORM_SOLAPI_API_SECRET;
    if (!apiKey || !apiSecret) {
      return {
        ok: false,
        error:
          "캐스트로그 발송 계정이 서버에 설정되지 않았습니다 (PLATFORM_SOLAPI_API_KEY/SECRET). 캐스트로그에 문의하세요.",
      };
    }
    return {
      ok: true,
      creds: { provider: "solapi", apiKey, apiSecret },
      senderNumber: config.sender_number,
    };
  }

  if (!config.api_key_encrypted) {
    return {
      ok: false,
      error: "자사 API 키가 등록되지 않았습니다. 설정 화면에서 등록하세요.",
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

/** 발신번호 비교용 정규화 — 숫자만, 국가번호 82는 0으로 */
export function normalizeSenderDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  return digits;
}

/** 개인 휴대폰 번호인가 (01x) — 유선·대표번호(02/031/070/15xx 등)와 구분 */
export function isPersonalMobileSender(digits: string): boolean {
  return /^01[016789]/.test(digits);
}

/**
 * 실제 발신번호 결정 (기획 확정 2026-08-22, 개정 — 기본값은 회사 대표번호):
 * - 기본값은 항상 **회사 대표번호** (자동 발송 포함).
 * - 명시 지정은 등록 목록 안에 있어야 하고, **개인 휴대폰(01x) 번호는 보내는
 *   직원 본인의 휴대폰과 일치할 때만** 허용한다 — 타인의 개인 번호로 발송할 수
 *   없어야 한다. 조건에 어긋나면 대표번호로 떨어진다.
 */
async function resolveSenderNumber(
  supabase: ReturnType<typeof createClient>,
  params: TenantSmsSendParams,
  defaultSender: string
): Promise<string> {
  const fallback = normalizeSenderDigits(defaultSender);
  const requested = params.senderNumber
    ? normalizeSenderDigits(params.senderNumber)
    : null;
  if (!requested || requested === fallback) return fallback;

  const choices = new Set<string>([fallback]);
  const { data: extra, error } = await supabase
    .from("tenant_sms_senders")
    .select("phone")
    .eq("tenant_id", params.tenantId);
  if (!error) {
    for (const row of extra ?? []) choices.add(normalizeSenderDigits(row.phone));
  }
  // error(테이블 미생성 등)면 대표번호만 — 발송이 죽으면 안 된다

  if (!choices.has(requested)) return fallback;

  if (isPersonalMobileSender(requested)) {
    if (!params.senderUserId) return fallback;
    const { data: senderUser } = await supabase
      .from("users")
      .select("phone")
      .eq("id", params.senderUserId)
      .maybeSingle();
    const own = senderUser?.phone
      ? normalizeSenderDigits(senderUser.phone)
      : null;
    return own === requested ? requested : fallback;
  }

  return requested;
}

/**
 * MMS 이미지 업로드 (기획 확정 2026-08-23) — 테넌트 SMS 설정(솔라피)으로
 * 공급자 저장소에 올리고 imageId를 받는다. 발송(즉시·예약)은 이 id를 쓴다.
 */
export async function uploadTenantMmsImage(params: {
  tenantId: string;
  base64: string;
  name: string;
}): Promise<
  { ok: true; imageId: string; test?: boolean } | { ok: false; error: string }
> {
  if (isSmsTestMode()) {
    return { ok: true, imageId: "test-image", test: true };
  }
  const credsResult = await loadCredentials(params.tenantId, false);
  if (!credsResult.ok) return credsResult;
  return uploadMmsImage(credsResult.creds, {
    base64: params.base64,
    name: params.name,
  });
}

/** 발송 실행 — 전 건 sms_logs 기록 + 사용량 계측 */
export async function sendTenantSms(
  params: TenantSmsSendParams
): Promise<{ ok: true; summary: SendSummary } | { ok: false; error: string }> {
  const systemContext = params.systemContext === true;
  const supabase = systemContext ? createAdminClient() : createClient();
  const batchId = params.batchId ?? randomUUID();
  // 연습모드에서는 실제 발송을 하지 않는다. 흐름·이력은 그대로 남기되 공급자
  // 호출만 건너뛴다 — 발송 연습을 하다 실제 요금·오발송이 나면 안 된다.
  const practice = systemContext ? false : await isPracticeMode();
  const testMode = isSmsTestMode() || practice;

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

  const admin = createAdminClient();
  const credsResult = testMode
    ? null // 테스트 모드는 공급자 설정 없이도 동작
    : await loadCredentials(params.tenantId, systemContext);
  if (credsResult && !credsResult.ok) {
    // 공급자 호출 전에 막혀도 **전 건 기록**한다 (§12-3) — 기록이 없으면
    // "보냈다"고 믿은 담당자가 왜 안 갔는지 알 길이 없다. 세션별 송신 현황
    // 카드가 이 행의 error_message를 실패 사유로 보여 준다.
    await insertSmsLog(
      admin,
      targets.map((recipient) => ({
        tenant_id: params.tenantId,
        batch_id: batchId,
        message_type: params.messageType,
        recipient_phone: recipient.phone,
        recipient_expert_id: recipient.expertId,
        body: params.body,
        status: "failed" as const,
        provider: null,
        error_message: credsResult.error,
        sent_by: params.senderUserId ?? null,
        engagement_ids: params.engagementIds ?? null,
      }))
    );
    return credsResult;
  }

  const fromNumber = credsResult?.ok
    ? await resolveSenderNumber(supabase, params, credsResult.senderNumber)
    : null;

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
          from: fromNumber ?? credsResult.senderNumber,
          text: finalBody,
          imageId: params.imageId ?? null,
        })
      : ({ ok: true, test: true } as const);

    const status = result.ok ? (result.test ? "test" : "sent") : "failed";
    if (result.ok) sent += 1;
    else failed += 1;

    // 기록은 service_role로 — sms_logs INSERT 정책(레벨 4 실행 직급)에 걸리면
    // 발송은 됐는데 이력만 빠지는 무증상 결함이 된다. tenant_id는 명시한다
    await insertSmsLog(admin, [
      {
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
        engagement_ids: params.engagementIds ?? null,
      },
    ]);
  }

  // 사용량 계측 (설계문서 4.2 — 과금 없음, 계측만)
  if (sent > 0) {
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
