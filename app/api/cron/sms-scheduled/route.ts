import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  isNightTimeKst,
  sendTenantSms,
  type SmsRecipient,
} from "@/lib/sms/send";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 예약 문자 발송 처리 (기획 확정 2026-08-23 — Vercel Cron, vercel.json 참조).
 * 기한이 도래한 sms_send_batches(status='scheduled')를 발송한다.
 *
 * - 동시 실행 대비: status를 'scheduled' 조건부로 'sending'으로 바꾼 건만 처리.
 * - 광고성이 크론 지연으로 야간에 걸리면 실패 처리하지 않고 다음 회차로 넘긴다
 *   (아침 8시 이후 회차에서 발송된다).
 * - 인증은 다른 크론과 동일: CRON_SECRET Bearer 또는 Vercel Cron 헤더.
 */
export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : request.headers.get("x-vercel-cron") !== null;
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: due } = await admin
    .from("sms_send_batches")
    .select("id, tenant_id, message_type, body, sender_number, created_by, title, mms_image_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  let processed = 0;
  let deferred = 0;
  let failed = 0;

  for (const batch of due ?? []) {
    // 광고성 야간 도래(크론 지연 등) → 다음 회차로 미룬다. 실패가 아니다.
    if (batch.message_type === "advertising" && isNightTimeKst()) {
      deferred += 1;
      continue;
    }

    // 조건부 선점 — 동시 실행돼도 한 쪽만 통과한다
    const { data: claimed } = await admin
      .from("sms_send_batches")
      .update({ status: "sending" })
      .eq("id", batch.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: recipientRows } = await admin
      .from("sms_send_batch_recipients")
      .select("expert_id, name, phone")
      .eq("batch_id", batch.id);
    const recipients: SmsRecipient[] = (recipientRows ?? []).map((r) => ({
      phone: r.phone,
      expertId: r.expert_id,
      name: r.name ?? "",
    }));

    if (recipients.length === 0) {
      await admin
        .from("sms_send_batches")
        .update({ status: "failed", last_error: "수신자가 없습니다." })
        .eq("id", batch.id);
      failed += 1;
      continue;
    }

    const result = await sendTenantSms({
      tenantId: batch.tenant_id,
      senderUserId: batch.created_by,
      messageType: batch.message_type as "transactional" | "advertising",
      body: batch.body,
      recipients,
      senderNumber: batch.sender_number,
      systemContext: true,
      batchId: batch.id,
      imageId: batch.mms_image_id,
    });

    if (result.ok) {
      await admin
        .from("sms_send_batches")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_count: result.summary.sent,
          failed_count: result.summary.failed,
          excluded_count: result.summary.excluded,
          last_error: null,
        })
        .eq("id", batch.id);
      processed += 1;
    } else {
      await admin
        .from("sms_send_batches")
        .update({ status: "failed", last_error: result.error.slice(0, 300) })
        .eq("id", batch.id);
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, processed, deferred, failed });
}
