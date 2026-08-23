"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { canExec, execDeniedMessage } from "@/lib/auth/exec-permissions";
import { gradeFromUser } from "@/lib/auth/tenant";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { notifyExpert } from "@/lib/experts/notifications";
import { sendEngagementEmail } from "@/lib/integrations/engagement-email";
import {
  buildEngagementRequestSms,
  sendEngagementSms,
} from "@/lib/integrations/engagement-sms";
import { assertEngagementAllowed } from "@/lib/integrations/engagement-plans";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";
import { getTenantModules } from "@/lib/modules/server";

export type RequestFromPositionResult =
  | { ok: true; url: string }
  | { ok: false; error: string; needsPmApproval?: true };


/**
 * 넘버링코드(포지션) 기준 섭외요청 — 슬롯의 일정·역할·비용·장소를 그대로 승계한다.
 * 성공 시 포지션이 'requested'로 전환되고 생성된 섭외건과 연결된다.
 */
export async function requestEngagementForPosition(input: {
  positionId: string;
  expertId: string;
  programName?: string;
  eventSummary?: string;
  specialNotes?: string;
  message?: string;
  responseDeadline?: string;
  /** 발송 수단 — 일괄 발송에서 지정한다. 없으면 문자·이메일 모두 */
  channel?: "sms" | "email" | "both";
}): Promise<RequestFromPositionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!canExec("engagementRequest", gradeFromUser(user), role)) {
    return { ok: false, error: execDeniedMessage("engagementRequest") };
  }

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, slot_id, status, code")
    .eq("id", input.positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  // 임의 배정된 자리에서 일괄 발송으로 나가는 것이 기본 경로다.
  // 배정 없이 바로 보내는 경로(open)도 남겨 둔다 — 급한 한 자리 보충에 쓴다.
  if (position.status !== "open" && position.status !== "assigned") {
    return { ok: false, error: "이미 섭외가 진행 중이거나 확정된 인원입니다." };
  }

  const { data: slot } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, starts_time, ends_time, role_type, session_name, role_description, fee_amount, location_name, location_address"
    )
    .eq("id", position.slot_id)
    .maybeSingle();
  if (!slot) return { ok: false, error: "슬롯을 찾을 수 없습니다." };

  // 섭외계획 품의 게이트 (approvals 모듈 활성 테넌트만)
  const modules = await getTenantModules();
  const planGate = await assertEngagementAllowed(slot.project_id, modules.approvals);
  if (!planGate.ok) return planGate;

  // 부PM 실행 게이트 — PM 승인 1건을 소진한다. PM·대표·이사는 그대로 통과.
  const deputyGate = await gateDeputyAction({
    projectId: slot.project_id,
    actionType: "engagement.request",
    targetId: position.id,
  });
  if (!deputyGate.ok) {
    return {
      ok: false,
      error: deputyGate.error,
      ...(deputyGate.needsPmApproval ? { needsPmApproval: true as const } : {}),
    };
  }

  // 활성 연결 확인
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", input.expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 섭외할 수 있습니다." };
  }

  const token = generateLinkToken();
  const { data: engagement, error } = await supabase
    .from("expert_engagements")
    .insert({
      tenant_id: tenantId,
      expert_id: input.expertId,
      project_id: slot.project_id,
      role_description:
        slot.role_description || `${position.code} 섭외`,
      role_type: slot.role_type,
      session_name: slot.session_name,
      position_code: position.code,
      program_name: input.programName?.trim() || null,
      message: input.message?.trim() || null,
      fee_amount: slot.fee_amount,
      starts_on: slot.slot_date,
      ends_on: slot.slot_date,
      starts_time: slot.starts_time,
      ends_time: slot.ends_time,
      location_name: slot.location_name,
      location_address: slot.location_address,
      event_summary: input.eventSummary?.trim() || null,
      special_notes: input.specialNotes?.trim() || null,
      token_hash: hashLinkToken(token),
      token_expires_at: (input.responseDeadline
        ? new Date(input.responseDeadline)
        : new Date(Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
      ).toISOString(),
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (error || !engagement) {
    return { ok: false, error: "섭외 요청 생성에 실패했습니다." };
  }

  const { error: linkError } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "requested",
      engagement_id: engagement.id,
      expert_id: input.expertId,
    })
    .eq("id", position.id)
    .in("status", ["open", "assigned"]);
  if (linkError) {
    return { ok: false, error: "인원 연결에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "engagement.request",
    resource_type: "expert_engagement",
    resource_id: engagement.id,
    after_data: { position_code: position.code, expert_id: input.expertId },
  });

  await notifyExpert({
    expertId: input.expertId,
    category: "engagement_request",
    title: "새로운 섭외 요청이 도착했습니다",
    body: [
      input.programName?.trim() || null,
      formatEventSchedule(
        slot.slot_date,
        slot.slot_date,
        slot.starts_time,
        slot.ends_time
      ),
      slot.location_name,
    ]
      .filter(Boolean)
      .join(" · "),
    link: "/expert/engagements",
    tenantId,
  });

  let url: string;
  try {
    url = buildPublicLink("engagementConsent", token);
  } catch {
    url = `/e/${token}`;
  }

  // 업무연락 메일 — 동의 링크 전달
  const schedule = formatEventSchedule(
    slot.slot_date,
    slot.slot_date,
    slot.starts_time,
    slot.ends_time
  );
  const channel = input.channel ?? "both";
  const useEmail = channel === "email" || channel === "both";
  const useSms = channel === "sms" || channel === "both";

  if (useEmail)
  await sendEngagementEmail({
    tenantId,
    senderUserId: user.id,
    expertId: input.expertId,
    subject: `[섭외 요청] ${input.programName?.trim() || position.code}`,
    body:
      `섭외를 요청드립니다.\n\n` +
      [
        input.programName?.trim() ? `· 사업명: ${input.programName.trim()}` : null,
        slot.role_description ? `· 역할: ${slot.role_description}` : null,
        schedule ? `· 일정: ${schedule}` : null,
        slot.location_name
          ? `· 장소: ${slot.location_name}${
              slot.location_address ? ` (${slot.location_address})` : ""
            }`
          : null,
        slot.fee_amount
          ? `· 의뢰비용: ${slot.fee_amount.toLocaleString("ko-KR")}원`
          : null,
      ]
        .filter(Boolean)
        .join("\n") +
      `\n\n아래 링크에서 수락 또는 거절해 주세요.\n${url}\n`,
  });

  // 문자 — 이메일을 등록하지 않은 전문가에게는 이게 유일한 실질 연락 수단이다.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  if (useSms)
  await sendEngagementSms({
    tenantId,
    senderUserId: user.id,
    expertId: input.expertId,
    body: buildEngagementRequestSms({
      tenantName: tenant?.name ?? "캐스트로그",
      programName: input.programName?.trim() || null,
      schedule,
      locationName: slot.location_name,
      url,
    }),
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, url };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/**
 * 코드넘버 자리 해제 — 다시 미섭외 상태로 되돌린다.
 *
 * 자리만 풀고 섭외 건을 그대로 두면 안 된다. 전문가에게는 아직 살아 있는 동의
 * 링크가 있어서, 회사가 '해제했다'고 믿는 자리를 나중에 수락해 버릴 수 있다
 * (수락서까지 자동 생성된다). 그 사이 다른 전문가를 붙였다면 같은 세션에 두
 * 명이 확정된다. 그래서 자리를 풀 때 진행 중인 섭외요청도 함께 회수한다.
 *
 * 이미 수락된(확정) 건은 여기서 풀지 않는다 — 계약이 성립한 건이므로 사유를
 * 남기는 '섭외 취소'를 거쳐야 한다 (긴급 취소는 전사 알림 대상이다).
 */
export async function releasePosition(positionId: string): Promise<SimpleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!canExec("engagementCancel", gradeFromUser(user), role)) {
    return { ok: false, error: execDeniedMessage("engagementCancel") };
  }

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, status, engagement_id, expert_id")
    .eq("id", positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (position.status === "open") return { ok: true };

  // 연결된 섭외 건의 상태를 먼저 확인한다.
  let engagementStatus: string | null = null;
  if (position.engagement_id) {
    const { data: engagement } = await supabase
      .from("expert_engagements")
      .select("id, status")
      .eq("id", position.engagement_id)
      .maybeSingle();
    engagementStatus = engagement?.status ?? null;

    if (engagementStatus === "accepted") {
      return {
        ok: false,
        error:
          "이미 수락된 섭외입니다. ‘섭외 취소’에서 사유를 남기고 취소해 주세요.",
      };
    }

    // 아직 응답 전인 요청은 함께 회수한다 — 살아 있는 동의 링크를 무효화한다.
    if (engagementStatus === "requested") {
      await supabase
        .from("expert_engagements")
        .update({ status: "canceled" })
        .eq("id", position.engagement_id)
        .eq("status", "requested");

      if (position.expert_id) {
        await supabase.from("engagement_cancellations").insert({
          tenant_id: tenantId,
          engagement_id: position.engagement_id,
          expert_id: position.expert_id,
          prior_status: "requested",
          is_urgent: false,
          reason: `코드넘버 ${position.code} 자리 해제`,
          canceled_by: user.id,
        });

        await notifyExpert({
          expertId: position.expert_id,
          category: "engagement_cancelled",
          title: "섭외 요청이 회수되었습니다",
          link: "/expert/engagements",
          tenantId,
        });
      }
    }
  }

  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({ status: "open", engagement_id: null, expert_id: null })
    .eq("id", positionId);
  if (error) return { ok: false, error: "해제에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "position.release",
    resource_type: "engagement_slot_position",
    resource_id: positionId,
    before_data: {
      status: position.status,
      engagement_id: position.engagement_id,
      engagement_status: engagementStatus,
    },
    after_data: { code: position.code, status: "open" },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
