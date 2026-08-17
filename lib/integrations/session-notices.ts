import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTenantSms, type SmsRecipient } from "@/lib/sms/send";
import { formatEventSchedule, roleTypeLabel } from "./engagement-roles";

export {
  NOTICE_VARIABLES,
  DEFAULT_NOTICE_BODY,
} from "./notice-constants";

/**
 * 세션(타임테이블)별 전문가 안내문자 (operations ↔ 발송 인프라)
 *
 *  * 대상은 해당 세션에 섭외가 **확정(filled)** 된 전문가다. 요청중·미섭외는 제외한다.
 *  * 유형은 업무연락(transactional) 고정 — 광고성으로 보낼 수 없게 코드에서 못 박는다(§5-1).
 *  * 문구는 템플릿 테이블로 관리하고(§14-2), 발송 시점 문구를 건별로 스냅샷한다.
 *  * 즉시 발송과 예약 발송이 같은 실행 경로(dispatchSessionNotice)를 쓴다 —
 *    예약분은 크론이 같은 함수를 호출하므로 동작이 갈리지 않는다.
 */

export type NoticeRecipient = {
  expertId: string;
  name: string;
  phone: string;
  code: string;
};

export type SessionNoticeContext = {
  tenantId: string;
  tenantName: string;
  projectId: string;
  projectName: string;
  slotId: string;
  sessionName: string | null;
  slotDate: string;
  startsTime: string | null;
  endsTime: string | null;
  roleType: string;
  locationName: string | null;
  locationAddress: string | null;
  recipients: NoticeRecipient[];
};

/** 세션 안내 대상·문맥 조회. 확정 전문가가 없으면 recipients가 빈 배열이다. */
export async function getSessionNoticeContext(
  slotId: string
): Promise<SessionNoticeContext | null> {
  const admin = createAdminClient();

  const { data: slot } = await admin
    .from("engagement_slots")
    .select(
      "id, tenant_id, project_id, slot_date, starts_time, ends_time, role_type, session_name, location_name, location_address"
    )
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return null;

  const [{ data: tenant }, { data: project }, { data: positions }] =
    await Promise.all([
      admin.from("tenants").select("name").eq("id", slot.tenant_id).maybeSingle(),
      admin
        .from("projects")
        .select("name")
        .eq("id", slot.project_id)
        .maybeSingle(),
      admin
        .from("engagement_slot_positions")
        .select("code, expert_id, status")
        .eq("slot_id", slotId)
        .eq("status", "filled"),
    ]);

  const expertIds = (positions ?? [])
    .map((p) => p.expert_id)
    .filter((id): id is string => id !== null);

  const { data: experts } = expertIds.length
    ? await admin.from("experts").select("id, name, phone").in("id", expertIds)
    : { data: null };
  const expertById = new Map((experts ?? []).map((e) => [e.id, e]));

  const recipients: NoticeRecipient[] = [];
  for (const position of positions ?? []) {
    if (!position.expert_id) continue;
    const expert = expertById.get(position.expert_id);
    // 휴대폰이 없으면 문자를 보낼 수 없다 — 대상에서 제외하고 화면에서 알린다
    if (!expert?.phone) continue;
    recipients.push({
      expertId: expert.id,
      name: expert.name,
      phone: expert.phone,
      code: position.code,
    });
  }

  return {
    tenantId: slot.tenant_id,
    tenantName: tenant?.name ?? "",
    projectId: slot.project_id,
    projectName: project?.name ?? "",
    slotId: slot.id,
    sessionName: slot.session_name,
    slotDate: slot.slot_date,
    startsTime: slot.starts_time,
    endsTime: slot.ends_time,
    roleType: slot.role_type,
    locationName: slot.location_name,
    locationAddress: slot.location_address,
    recipients,
  };
}

function timeRange(startsTime: string | null, endsTime: string | null): string {
  if (startsTime && endsTime) {
    return `${startsTime.slice(0, 5)} ~ ${endsTime.slice(0, 5)}`;
  }
  if (startsTime) return startsTime.slice(0, 5);
  return "시간 미정";
}

/** 수신자 1명 기준으로 치환 변수를 채운다. */
export function renderNoticeBody(
  template: string,
  context: SessionNoticeContext,
  recipient: Pick<NoticeRecipient, "name" | "code">
): string {
  const location = context.locationName
    ? context.locationAddress
      ? `${context.locationName} (${context.locationAddress})`
      : context.locationName
    : "장소 미정";

  const replacements: Record<string, string> = {
    "{전문가명}": recipient.name,
    "{기업명}": context.tenantName,
    "{사업명}": context.projectName,
    "{세션명}": context.sessionName ?? context.projectName,
    "{일정}":
      formatEventSchedule(
        context.slotDate,
        context.slotDate,
        context.startsTime,
        context.endsTime
      ) || context.slotDate,
    "{일자}": context.slotDate,
    "{시간}": timeRange(context.startsTime, context.endsTime),
    "{장소}": location,
    "{역할}": roleTypeLabel(context.roleType) ?? context.roleType,
    "{코드}": recipient.code,
  };

  return Object.entries(replacements).reduce(
    (body, [key, value]) => body.split(key).join(value),
    template
  );
}

export type DispatchResult =
  | { ok: true; sent: number; failed: number }
  | { ok: false; error: string };

/**
 * 안내문자 실제 발송. 즉시 발송과 크론의 예약 발송이 같은 경로를 쓴다.
 *
 * 치환 결과가 수신자마다 다르므로 1인 1건으로 보낸다 — sendTenantSms가
 * 전 건 sms_logs를 남기므로 발송 이력은 그대로 추적된다.
 */
export async function dispatchSessionNotice(
  noticeId: string
): Promise<DispatchResult> {
  const admin = createAdminClient();

  // 경합 방지 — scheduled 상태일 때만 집어간다
  const { data: notice } = await admin
    .from("session_notices")
    .select("id, tenant_id, slot_id, body_template, status, created_by")
    .eq("id", noticeId)
    .maybeSingle();
  if (!notice) return { ok: false, error: "안내문자 건을 찾을 수 없습니다." };
  if (notice.status !== "scheduled") {
    return { ok: false, error: "이미 처리된 안내문자입니다." };
  }

  const context = await getSessionNoticeContext(notice.slot_id);
  if (!context) {
    await admin
      .from("session_notices")
      .update({ status: "failed", last_error: "세션을 찾을 수 없습니다." })
      .eq("id", noticeId);
    return { ok: false, error: "세션을 찾을 수 없습니다." };
  }

  if (context.recipients.length === 0) {
    await admin
      .from("session_notices")
      .update({
        status: "failed",
        last_error: "발송 대상이 없습니다(확정 전문가 또는 휴대폰 번호 없음).",
      })
      .eq("id", noticeId);
    return { ok: false, error: "발송 대상이 없습니다." };
  }

  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;
  let batchId: string | null = null;

  for (const recipient of context.recipients) {
    const body = renderNoticeBody(notice.body_template, context, recipient);
    const target: SmsRecipient = {
      phone: recipient.phone,
      expertId: recipient.expertId,
      name: recipient.name,
    };

    const result = await sendTenantSms({
      tenantId: notice.tenant_id,
      senderUserId: notice.created_by,
      // 업무연락 고정 — 광고성으로 보낼 수 없다 (§5-1)
      messageType: "transactional",
      body,
      recipients: [target],
      // 예약 발송(크론)에는 세션이 없다 — 설정 조회·로그 기록을 service_role로
      systemContext: true,
    });

    if (result.ok) {
      sent += result.summary.sent;
      failed += result.summary.failed;
      batchId = batchId ?? result.summary.batchId;
    } else {
      failed += 1;
      lastError = result.error;
    }
  }

  await admin
    .from("session_notices")
    .update({
      status: sent > 0 ? "sent" : "failed",
      sent_at: new Date().toISOString(),
      batch_id: batchId,
      recipient_count: context.recipients.length,
      sent_count: sent,
      failed_count: failed,
      last_error: lastError,
    })
    .eq("id", noticeId);

  await admin.from("audit_logs").insert({
    tenant_id: notice.tenant_id,
    actor_auth_user_id: notice.created_by,
    actor_role: "system",
    action: "session_notice.dispatch",
    resource_type: "session_notice",
    resource_id: noticeId,
    after_data: { sent, failed, recipients: context.recipients.length },
  });

  if (sent === 0) {
    return { ok: false, error: lastError ?? "발송에 실패했습니다." };
  }
  return { ok: true, sent, failed };
}

/** 예약 시각이 지난 대기 건을 모두 발송한다 (크론 진입점). */
export async function dispatchDueSessionNotices(): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const admin = createAdminClient();
  const { data: due } = await admin
    .from("session_notices")
    .select("id")
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", new Date().toISOString())
    .limit(100);

  let sent = 0;
  let failed = 0;
  for (const row of due ?? []) {
    const result = await dispatchSessionNotice(row.id);
    if (result.ok) {
      sent += result.sent;
      failed += result.failed;
    } else {
      failed += 1;
    }
  }
  return { processed: (due ?? []).length, sent, failed };
}
