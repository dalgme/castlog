"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  messageSendSchema,
  type MessageSendInput,
} from "@/lib/messaging/schemas";
import { sendTenantSms, type SmsRecipient } from "@/lib/sms/send";
import { sendTenantEmail, type EmailRecipient } from "@/lib/email/send";

export type SendMessageResult =
  | {
      ok: true;
      scheduled: false;
      sent: number;
      failed: number;
      excluded: number;
      testMode: boolean;
    }
  | { ok: true; scheduled: true; scheduledAt: string; recipients: number }
  | { ok: false; error: string };

/** KST datetime-local("YYYY-MM-DDTHH:mm") → Date */
function parseKstLocal(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

/**
 * 발송 실행 (관리자 이상 — 위험 작업, 클라이언트 2단계 확인 후 호출)
 * 유형별 강제 규칙은 lib/sms·lib/email 발송 서비스가 서버에서 적용한다.
 * scheduledAt이 있으면 즉시 발송하지 않고 예약 건으로 저장한다(크론이 발송).
 */
export async function sendMessage(
  input: MessageSendInput
): Promise<SendMessageResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = messageSendSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "발송 권한이 없습니다." };
  }

  // 수신 대상: 활성 연결 전문가만 (RLS)
  const { data: experts } = await supabase
    .from("experts")
    .select("id, name, phone, email")
    .in("id", data.expertIds);

  if (!experts || experts.length === 0) {
    return { ok: false, error: "수신 대상을 찾을 수 없습니다." };
  }

  if (data.channel === "sms") {
    const recipients: SmsRecipient[] = experts.map((e) => ({
      phone: e.phone,
      expertId: e.id,
      name: e.name,
    }));
    // 서명 문구 — 문자 하단 자동 추가 (기획 확정 2026-08-22)
    const smsBody = data.signature
      ? `${data.body}\n\n${data.signature}`
      : data.body;
    if (smsBody.length > 1800) {
      return {
        ok: false,
        error: "내용과 서명 문구를 합쳐 1800자 이내여야 합니다. 내용을 줄여 주세요.",
      };
    }

    // ── 예약발송 (기획 확정 2026-08-23) ──────────────────────────────
    if (data.scheduledAt) {
      const when = parseKstLocal(data.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return { ok: false, error: "예약 시각을 확인하세요." };
      }
      if (when.getTime() < Date.now() + 5 * 60 * 1000) {
        return {
          ok: false,
          error: "예약 시각은 지금부터 최소 5분 뒤여야 합니다. 바로 보내려면 예약을 끄세요.",
        };
      }
      if (when.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000) {
        return { ok: false, error: "예약은 60일 이내까지만 가능합니다." };
      }
      // 광고성 야간(21~08 KST) 예약 금지 — 발송 시점 차단을 예약 시점에 미리 알린다
      const kstHour = parseInt(data.scheduledAt.slice(11, 13), 10);
      if (data.messageType === "advertising" && (kstHour >= 21 || kstHour < 8)) {
        return {
          ok: false,
          error: "광고성 문자는 야간(21시~익일 8시)에 발송할 수 없어 그 시간대로 예약할 수 없습니다.",
        };
      }

      const { data: batch, error: batchError } = await supabase
        .from("sms_send_batches")
        .insert({
          tenant_id: tenantId,
          title: data.title,
          message_type: data.messageType,
          body: smsBody,
          sender_number: data.senderNumber ?? null,
          status: "scheduled",
          scheduled_at: when.toISOString(),
          recipient_count: recipients.length,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (batchError || !batch) {
        return {
          ok: false,
          error: "예약 저장에 실패했습니다. 마이그레이션 미적용(발송 이력)일 수 있습니다 — 캐스트로그에 알려 주세요.",
        };
      }
      const { error: recipError } = await supabase
        .from("sms_send_batch_recipients")
        .insert(
          recipients.map((r) => ({
            batch_id: batch.id,
            tenant_id: tenantId,
            expert_id: r.expertId,
            name: r.name,
            phone: r.phone,
          }))
        );
      if (recipError) {
        await supabase
          .from("sms_send_batches")
          .update({ status: "canceled", last_error: "수신자 저장 실패" })
          .eq("id", batch.id);
        return { ok: false, error: "예약 수신자 저장에 실패했습니다. 다시 시도해 주세요." };
      }

      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor_auth_user_id: user.id,
        actor_role: role,
        action: "message.schedule",
        resource_type: "sms_send_batch",
        resource_id: batch.id,
        after_data: {
          title: data.title,
          message_type: data.messageType,
          scheduled_at: when.toISOString(),
          recipients: recipients.length,
        },
      });

      revalidatePath("/[tenantSlug]/messages", "page");
      return {
        ok: true,
        scheduled: true,
        scheduledAt: when.toISOString(),
        recipients: recipients.length,
      };
    }

    // ── 즉시 발송 — 발송 건 id를 미리 만들어 로그와 연결 ─────────────
    const batchId = randomUUID();
    const result = await sendTenantSms({
      tenantId,
      senderUserId: user.id,
      messageType: data.messageType,
      body: smsBody,
      recipients,
      senderNumber: data.senderNumber ?? null,
      batchId,
    });
    if (!result.ok) return result;
    const summary = result.summary;

    // 발송 건 기록 (실패해도 발송 자체는 이미 끝났으므로 오류를 돌려주지 않는다)
    await supabase.from("sms_send_batches").insert({
      id: batchId,
      tenant_id: tenantId,
      title: data.title,
      message_type: data.messageType,
      body: smsBody,
      sender_number: data.senderNumber ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_count: recipients.length,
      sent_count: summary.sent,
      failed_count: summary.failed,
      excluded_count: summary.excluded,
      created_by: user.id,
    });

    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_auth_user_id: user.id,
      actor_role: role,
      action: "message.send",
      resource_type: "message_batch",
      after_data: {
        channel: data.channel,
        message_type: data.messageType,
        batch_id: batchId,
        title: data.title,
        sent: summary.sent,
        excluded: summary.excluded,
      },
    });

    revalidatePath("/[tenantSlug]/messages", "page");
    return {
      ok: true,
      scheduled: false,
      sent: summary.sent,
      failed: summary.failed,
      excluded: summary.excluded,
      testMode: summary.testMode,
    };
  }

  // ── 이메일 (예약 미지원 — 즉시 발송) ─────────────────────────────
  const withEmail = experts.filter(
    (e): e is typeof e & { email: string } => !!e.email
  );
  if (withEmail.length === 0) {
    return { ok: false, error: "이메일이 등록된 대상이 없습니다." };
  }
  const recipients: EmailRecipient[] = withEmail.map((e) => ({
    email: e.email,
    expertId: e.id,
    name: e.name,
  }));
  const result = await sendTenantEmail({
    tenantId,
    senderUserId: user.id,
    messageType: data.messageType,
    subject: data.subject ?? "",
    body: data.body,
    recipients,
  });
  if (!result.ok) return result;
  const summary = result.summary;

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "message.send",
    resource_type: "message_batch",
    after_data: {
      channel: data.channel,
      message_type: data.messageType,
      batch_id: summary.batchId,
      title: data.title,
      sent: summary.sent,
      excluded: summary.excluded,
    },
  });

  revalidatePath("/[tenantSlug]/messages", "page");
  return {
    ok: true,
    scheduled: false,
    sent: summary.sent,
    failed: summary.failed,
    excluded: summary.excluded,
    testMode: summary.testMode,
  };
}

export type CancelScheduledResult = { ok: true } | { ok: false; error: string };

/** 예약 발송 취소 — 발송 전(scheduled) 건만. (CLAUDE.md 14-5 — 예약·중지) */
export async function cancelScheduledMessage(
  batchId: string
): Promise<CancelScheduledResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "발송 권한이 없습니다." };
  }

  // 조건부 갱신 — 이미 발송 중·완료된 건은 건드리지 않는다
  const { data: updated, error } = await supabase
    .from("sms_send_batches")
    .update({ status: "canceled" })
    .eq("id", batchId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "취소에 실패했습니다. 다시 시도해 주세요." };
  if (!updated) {
    return {
      ok: false,
      error: "이미 발송되었거나 취소된 건입니다. 목록을 새로고침해 확인하세요.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "message.schedule_cancel",
    resource_type: "sms_send_batch",
    resource_id: batchId,
  });

  revalidatePath("/[tenantSlug]/messages", "page");
  return { ok: true };
}
