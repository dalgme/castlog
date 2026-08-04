"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hashLinkToken } from "@/lib/auth/tokens";

export type UnsubscribeResult = { ok: true } | { ok: false; error: string };

/**
 * 수신거부 처리 (법적 필수 — /u 공개 링크, 로그인 불필요)
 * 발송 주체(테넌트) 단위로 광고 수신을 차단하고, 전문가 계정이 연결된 경우
 * 광고 수신동의 철회 이력(ad_consents granted=false)도 기록한다.
 */
export async function processUnsubscribe(
  token: string
): Promise<UnsubscribeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const admin = createAdminClient();
  const { data: record } = await admin
    .from("unsubscribe_tokens")
    .select("id, tenant_id, channel, phone, email, expert_id")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();

  if (!record) {
    return { ok: false, error: "유효하지 않은 수신거부 링크입니다." };
  }

  // 테넌트 단위 수신거부 (중복이면 무시)
  const { error: insertError } = await admin.from("ad_unsubscribes").insert({
    tenant_id: record.tenant_id,
    channel: record.channel === "email" ? "email" : "sms",
    phone: record.phone,
    email: record.email,
    expert_id: record.expert_id,
  });
  if (insertError && insertError.code !== "23505") {
    return { ok: false, error: "수신거부 처리에 실패했습니다. 다시 시도해 주세요." };
  }

  // 전문가 계정 연결 시 동의 철회 이력 (별도 테이블 원칙 — CLAUDE.md 5-1)
  if (record.expert_id) {
    await admin.from("ad_consents").insert({
      expert_id: record.expert_id,
      channel: record.channel === "email" ? "email" : "sms",
      granted: false,
      revoked_at: new Date().toISOString(),
    });
  }

  await admin.from("audit_logs").insert({
    tenant_id: record.tenant_id,
    actor_role: "public",
    action: "ad.unsubscribe",
    resource_type: "ad_unsubscribe",
    after_data: { channel: record.channel },
  });

  return { ok: true };
}
