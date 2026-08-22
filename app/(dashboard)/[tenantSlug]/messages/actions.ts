"use server";

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
      sent: number;
      failed: number;
      excluded: number;
      testMode: boolean;
    }
  | { ok: false; error: string };

/**
 * 발송 실행 (관리자 이상 — 위험 작업, 클라이언트 2단계 확인 후 호출)
 * 유형별 강제 규칙은 lib/sms·lib/email 발송 서비스가 서버에서 적용한다.
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

  let summary: {
    batchId: string;
    sent: number;
    failed: number;
    excluded: number;
    testMode: boolean;
  };

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
    const result = await sendTenantSms({
      tenantId,
      senderUserId: user.id,
      messageType: data.messageType,
      body: smsBody,
      recipients,
      senderNumber: data.senderNumber ?? null,
    });
    if (!result.ok) return result;
    summary = result.summary;
  } else {
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
    summary = result.summary;
  }

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
      sent: summary.sent,
      excluded: summary.excluded,
    },
  });

  revalidatePath("/[tenantSlug]/messages", "page");
  return {
    ok: true,
    sent: summary.sent,
    failed: summary.failed,
    excluded: summary.excluded,
    testMode: summary.testMode,
  };
}
