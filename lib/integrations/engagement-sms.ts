import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isTenantExpertsLite } from "@/lib/modules/server";
import { sendTenantSms } from "@/lib/sms/send";
import { sameFeeTerms, type EngagementFeeTerms } from "@/lib/sessions/fees";

/**
 * 섭외 조건 줄 (기획 지시 2026-09-21): 진행 방식(온라인 멘토링/오프라인 멘토링/
 * 온라인/오프라인 병행) · 총 회차 · 회차당 시간 · 회차당 단가(병행은 온/오프 각각).
 * 컨설팅(멘토링) 유형 — 회차당 단가가 있으면 **총액을 싣지 않는다**.
 */
export function feeTermsLines(t: EngagementFeeTerms | null | undefined): string[] {
  if (!t) return [];
  const countLine = [t.count, t.hours].filter(Boolean).join(" · ");
  return [
    t.mode ? `진행 방식: ${t.mode}` : null,
    countLine || null,
    t.unitFee,
  ].filter((v): v is string => Boolean(v));
}

function wonLabel(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/**
 * 섭외 워크플로우 업무연락 문자.
 *
 * 왜 필요한가: 섭외요청은 이메일과 포털 알림으로만 나가고 있었다. 그런데
 * experts의 필수 식별자는 휴대폰이고 이메일은 선택 항목이다. 이메일을 등록하지
 * 않은 전문가에게는 사실상 아무 연락도 가지 않고 포털 알림만 쌓였다 — 포털에
 * 로그인하지 않는 전문가는 섭외요청이 온 줄도 모르고 기한이 지났다.
 * 실무에서 섭외 연락의 기본 채널은 문자다.
 *
 * 업무연락(transactional)으로 고정한다 — 섭외요청·회수는 사전동의가 필요 없는
 * 계약 관련 연락이다 (CLAUDE.md §5-1). 광고성으로 보낼 수 없다.
 *
 * 발송 실패가 섭외 처리 자체를 막지 않는다. 공급자 미설정 테넌트도 있고,
 * 연락 수단은 이메일·포털 알림이 함께 나가기 때문이다.
 */
export async function sendEngagementSms(params: {
  tenantId: string;
  senderUserId: string;
  expertId: string;
  body: string;
  /** 이 문자가 담은 섭외 건 — 진행 탭 발송 이력 연결 (2026-09-05) */
  engagementIds?: string[];
}): Promise<void> {
  if (!hasSupabaseEnv()) return;
  // 라이트 모드(수기 섭외 관리) — 전문가에게 나가는 발송을 전부 끈다.
  // 개별 호출부가 아니라 여기서 자르는 이유: 발송 경로가 늘 때마다
  // 게이트를 빠뜨리는 사고를 막는다 (docs/decisions/experts-lite.md).
  if (await isTenantExpertsLite(params.tenantId)) return;
  try {
    const admin = createAdminClient();
    const { data: expert } = await admin
      .from("experts")
      .select("name, phone")
      .eq("id", params.expertId)
      .maybeSingle();
    if (!expert?.phone) return;

    const result = await sendTenantSms({
      tenantId: params.tenantId,
      senderUserId: params.senderUserId,
      messageType: "transactional",
      body: params.body,
      recipients: [
        { phone: expert.phone, expertId: params.expertId, name: expert.name },
      ],
      engagementIds: params.engagementIds ?? null,
    });
    if (!result.ok) {
      // 섭외 처리는 막지 않되 흔적은 남긴다 — sms_logs에는 sendTenantSms가
      // 실패 행을 기록했고, 서버 로그로도 원인을 볼 수 있어야 한다
      console.warn("[engagement-sms] send failed:", result.error);
    }
  } catch (error) {
    // 문자 실패가 섭외 처리를 막지 않는다 (이메일·포털 알림이 함께 나간다).
    console.warn("[engagement-sms] send threw:", error);
  }
}

/**
 * 묶음 섭외요청 문자 본문 (기획 확정 2026-08-30 — 20번).
 * 한 프로젝트의 여러 세션 건을 문자 1건으로 — 건별 상세는 링크에서 보여 주므로
 * 본문에는 몇 건인지·총액·마감만 싣는다.
 */
export function buildEngagementBundleSms(params: {
  tenantName: string;
  programName: string | null;
  itemCount: number;
  /** 건별 의뢰비용 합계(원) — null이면 표기 생략. 모든 건에 회차당 단가가 있으면 싣지 않는다 */
  totalFee: number | null;
  /**
   * 건별 섭외 조건 (기획 지시 2026-09-21). 모든 건이 같으면 한 번만, 다르면
   * 세션별 한 줄씩 싣는다. 건에 조건이 없으면 terms=null
   */
  items?: { name: string | null; terms: EngagementFeeTerms | null }[];
  deadline?: string | null;
  url: string;
}): string {
  const items = params.items ?? [];
  const allSame =
    items.length > 0 && items.every((i) => i.terms !== null && sameFeeTerms(i.terms, items[0]!.terms));
  const termLines = allSame
    ? feeTermsLines(items[0]!.terms)
    : items
        .filter((i) => i.terms !== null)
        .map((i) => {
          const t = i.terms!;
          const body = [t.mode, t.count, t.hours, t.unitFee].filter(Boolean).join(" · ");
          return body ? `· ${i.name ?? "세션"}: ${body}` : null;
        })
        .filter((v): v is string => Boolean(v));
  // 컨설팅(멘토링) 유형: 회차당 단가가 전부 있으면 총액(합계)을 싣지 않는다
  const unitEverywhere = items.length > 0 && items.every((i) => Boolean(i.terms?.unitFee));
  const fee = params.totalFee !== null && !unitEverywhere ? `의뢰비용 합계 ${wonLabel(params.totalFee)}` : null;
  const due = params.deadline
    ? `회신 마감 ${new Date(params.deadline).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
      })}까지`
    : null;
  return [
    `[${params.tenantName}] 섭외 요청 ${params.itemCount}건`,
    params.programName,
    ...termLines,
    fee,
    due,
    `각 건 확인·수락/거절: ${params.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 섭외요청 문자 본문 — 링크가 본문에 들어가므로 군더더기를 줄인다. */
export function buildEngagementRequestSms(params: {
  tenantName: string;
  programName: string | null;
  /** 일정 — 진행 방식·회차는 조건 줄에 따로 싣는다(중복 금지) */
  schedule: string | null;
  /** 섭외 조건 — 진행 방식(온라인/오프라인/병행)·총 회차·회차당 시간·회차당 단가(병행은 온/오프) (기획 지시 2026-09-21) */
  terms?: EngagementFeeTerms | null;
  locationName: string | null;
  /**
   * 의뢰비용 총액(원) — 전문가는 링크를 열기 전에 '얼마'를 알아야 한다 (검수 C4).
   * 컨설팅(멘토링) 유형(회차당 단가가 있는 세션)은 총액을 싣지 않고 회차당 단가만 싣는다
   */
  feeAmount?: number | null;
  /** 회신 마감 (ISO) — '언제까지 답해야 하는지'도 본문에 (검수 C4) */
  deadline?: string | null;
  url: string;
}): string {
  const termLines = feeTermsLines(params.terms);
  const fee =
    !params.terms?.unitFee && params.feeAmount !== null && params.feeAmount !== undefined
      ? `의뢰비용 ${wonLabel(params.feeAmount)}`
      : null;
  const due = params.deadline
    ? `회신 마감 ${new Date(params.deadline).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
      })}까지`
    : null;
  return [
    `[${params.tenantName}] 섭외 요청`,
    params.programName,
    params.schedule ? `일정: ${params.schedule}` : null,
    ...termLines,
    params.locationName ? `장소: ${params.locationName}` : null,
    fee,
    due,
    `수락/거절: ${params.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}
