import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getBaseUrl } from "@/lib/routing/links";
import { isTenantExpertsLite } from "@/lib/modules/server";
import { sendTenantEmail } from "@/lib/email/send";

/**
 * 섭외 워크플로우 업무연락 메일 (CLAUDE.md 5-1: 업무연락 = 사전동의 불요).
 *
 * 발송 정책(로그·계측·테스트 모드)은 sendTenantEmail에 위임한다. 이메일 제공자가
 * 미설정이면 테스트 모드로 기록만 되므로, 호출부는 성공/실패에 의존하지 않는다.
 * 전문가 이메일이 없으면 조용히 건너뛴다(앱 내 알림은 별도로 이미 발송됨).
 */
export async function sendEngagementEmail(params: {
  tenantId: string;
  senderUserId: string;
  expertId: string;
  subject: string;
  body: string;
  /** 답장 주소 — 미지정이면 발송 담당자(users.email)로 (E2E 검수 전문가 P2-5) */
  replyTo?: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;
  // 라이트 모드 — 전문가 발송 전면 차단 (engagement-sms.ts와 같은 이유)
  if (await isTenantExpertsLite(params.tenantId)) return;
  try {
    const admin = createAdminClient();
    const [{ data: expert }, { data: sender }] = await Promise.all([
      admin
        .from("experts")
        .select("name, email")
        .eq("id", params.expertId)
        .maybeSingle(),
      params.replyTo
        ? Promise.resolve({ data: null })
        : admin
            .from("users")
            .select("email")
            .eq("id", params.senderUserId)
            .eq("tenant_id", params.tenantId)
            .maybeSingle(),
    ]);
    if (!expert?.email) return;

    // "이 메일에 회신하시거나"라고 써 놓고 no-reply로 보내면 답장이 사라진다 —
    // 담당자 주소로 답장이 오게 한다. 담당자 주소가 없으면 헤더를 넣지 않는다
    const replyTo = params.replyTo ?? sender?.email ?? undefined;

    await sendTenantEmail({
      tenantId: params.tenantId,
      senderUserId: params.senderUserId,
      messageType: "transactional",
      subject: params.subject,
      body: params.body,
      recipients: [
        { email: expert.email, expertId: params.expertId, name: expert.name },
      ],
      replyTo,
    });
  } catch {
    // 메일 실패가 섭외·수락서 처리 자체를 막지 않는다.
  }
}

/** 포털 절대 URL (설정 미비 시 상대 경로로 폴백) */
export function portalUrl(path: string): string {
  try {
    return `${getBaseUrl()}${path}`;
  } catch {
    return path;
  }
}
