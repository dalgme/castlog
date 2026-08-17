"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { notifyExpert } from "@/lib/experts/notifications";
import { sendEngagementEmail } from "@/lib/integrations/engagement-email";

export type RequestFromPositionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const MANAGER_ROLES = ["org_admin", "manager"];

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
}): Promise<RequestFromPositionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "섭외 요청 권한이 없습니다." };
  }

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, slot_id, status, code")
    .eq("id", input.positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (position.status !== "open") {
    return { ok: false, error: "이미 섭외가 진행 중이거나 확정된 인원입니다." };
  }

  const { data: slot } = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, starts_time, ends_time, role_type, role_description, fee_amount, location_name, location_address"
    )
    .eq("id", position.slot_id)
    .maybeSingle();
  if (!slot) return { ok: false, error: "슬롯을 찾을 수 없습니다." };

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
    .eq("status", "open");
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

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, url };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** 포지션 섭외 취소 — 연결 해제 후 다시 미섭외 상태로. */
export async function releasePosition(positionId: string): Promise<SimpleResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "권한이 없습니다." };
  }

  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({ status: "open", engagement_id: null, expert_id: null })
    .eq("id", positionId);
  if (error) return { ok: false, error: "해제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
