import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { sendTenantSms } from "@/lib/sms/send";

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
}): Promise<void> {
  if (!hasSupabaseEnv()) return;
  try {
    const admin = createAdminClient();
    const { data: expert } = await admin
      .from("experts")
      .select("name, phone")
      .eq("id", params.expertId)
      .maybeSingle();
    if (!expert?.phone) return;

    await sendTenantSms({
      tenantId: params.tenantId,
      senderUserId: params.senderUserId,
      messageType: "transactional",
      body: params.body,
      recipients: [
        { phone: expert.phone, expertId: params.expertId, name: expert.name },
      ],
    });
  } catch {
    // 문자 실패가 섭외 처리를 막지 않는다 (이메일·포털 알림이 함께 나간다).
  }
}

/** 섭외요청 문자 본문 — 링크가 본문에 들어가므로 군더더기를 줄인다. */
export function buildEngagementRequestSms(params: {
  tenantName: string;
  programName: string | null;
  schedule: string | null;
  locationName: string | null;
  url: string;
}): string {
  return [
    `[${params.tenantName}] 섭외 요청`,
    params.programName,
    params.schedule,
    params.locationName,
    `수락/거절: ${params.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}
