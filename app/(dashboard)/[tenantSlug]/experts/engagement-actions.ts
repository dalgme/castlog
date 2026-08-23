"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { execDeniedMessage } from "@/lib/auth/exec-permissions";
import { canExecTenant } from "@/lib/auth/exec-policy";
import {
  ENGAGEMENT_EVENT_LABELS,
  logEngagementEvent,
  staffActorLabel,
  type EngagementEventType,
} from "@/lib/integrations/engagement-events";
import { applyEngagementResponse } from "@/lib/integrations/engagements";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { isPracticeMode } from "@/lib/practice/server";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";
import { buildUrgentCancelAlertTitle } from "@/lib/integrations/urgent-cancellations";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import {
  engagementCreateSchema,
  type EngagementCreateInput,
} from "@/lib/integrations/schemas";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { notifyExpert } from "@/lib/experts/notifications";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { sendEngagementEmail } from "@/lib/integrations/engagement-email";
import {
  buildEngagementRequestSms,
  sendEngagementSms,
} from "@/lib/integrations/engagement-sms";
import { assertEngagementAllowed } from "@/lib/integrations/engagement-plans";
import { releasePositionsForEngagement } from "@/lib/integrations/engagement-lifecycle";
import {
  screenExpertSchedule,
  type ScreenResult,
} from "@/lib/integrations/expert-availability";

export type CreateEngagementResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * 섭외 요청 생성 (experts ↔ operations 연동 — CLAUDE.md 1-2-6)
 * 활성 연결이 있는 전문가만 대상. 동의는 공개 /e 링크로 받는다 (업무연락).
 * SMS 발송은 단계 14 — 지금은 링크를 복사해 직접 전달한다.
 */
export async function createEngagement(
  input: EngagementCreateInput
): Promise<CreateEngagementResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const parsed = engagementCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  // 프로젝트 연결은 operations 모듈 활성 시에만 (연동 규칙)
  let projectId: string | null = null;
  if (data.projectId) {
    if (!modules.operations) {
      return { ok: false, error: "프로젝트 모듈이 비활성 상태입니다." };
    }
    projectId = data.projectId;
  }

  // 섭외계획 품의 게이트 — 승인된 계획이 있어야 프로젝트 섭외요청을 보낼 수 있다
  const planGate = await assertEngagementAllowed(projectId, modules.approvals);
  if (!planGate.ok) return planGate;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("engagementRequest", user))) {
    return { ok: false, error: execDeniedMessage("engagementRequest") };
  }

  // 활성 연결이 있는 전문가만 (RLS + 명시 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", data.expertId)
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
      expert_id: data.expertId,
      project_id: projectId,
      role_description: data.roleDescription,
      message: data.message || null,
      fee_amount: data.feeAmount ? parseInt(data.feeAmount, 10) : null,
      starts_on: data.startsOn || null,
      ends_on: data.endsOn || null,
      // 행사 상세 (수락서 양식 대응 — Phase A-2)
      program_name: data.programName?.trim() || null,
      role_type: data.roleType || null,
      starts_time: data.startsTime || null,
      ends_time: data.endsTime || null,
      location_name: data.locationName?.trim() || null,
      location_address: data.locationAddress?.trim() || null,
      event_summary: data.eventSummary?.trim() || null,
      special_notes: data.specialNotes?.trim() || null,
      token_hash: hashLinkToken(token),
      token_expires_at: (data.responseDeadline
        ? new Date(data.responseDeadline)
        : new Date(Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
      ).toISOString(),
      requested_by: user.id,
    })
    .select("id")
    .single();

  if (error || !engagement) {
    return { ok: false, error: "섭외 요청 생성에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "engagement.request",
    resource_type: "expert_engagement",
    resource_id: engagement.id,
    after_data: { expert_id: data.expertId, project_id: projectId },
  });

  // 섭외 이력 — 발송 담당자 이름으로 기록
  await logEngagementEvent({
    tenantId,
    engagementId: engagement.id,
    type: "requested",
    actorKind: "staff",
    actorLabel: await staffActorLabel(user.id),
    isPractice: await isPracticeMode(),
  });

  // 통합 알림함 — 전문가에게 섭외 요청 도착 알림
  await notifyExpert({
    expertId: data.expertId,
    category: "engagement_request",
    title: "새로운 섭외 요청이 도착했습니다",
    body: [
      data.programName?.trim() || null,
      formatEventSchedule(
        data.startsOn || null,
        data.endsOn || null,
        data.startsTime || null,
        data.endsTime || null
      ),
      data.locationName?.trim() || null,
      data.roleDescription,
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

  // 업무연락 메일 — 동의 링크 전달 (이메일 미설정 시 테스트 모드로 기록만)
  const schedule = formatEventSchedule(
    data.startsOn || null,
    data.endsOn || null,
    data.startsTime || null,
    data.endsTime || null
  );
  await sendEngagementEmail({
    tenantId,
    senderUserId: user.id,
    expertId: data.expertId,
    subject: `[섭외 요청] ${data.programName?.trim() || data.roleDescription}`,
    body:
      `섭외를 요청드립니다.\n\n` +
      [
        data.programName?.trim() ? `· 사업명: ${data.programName.trim()}` : null,
        `· 역할: ${data.roleDescription}`,
        schedule ? `· 일정: ${schedule}` : null,
        data.locationName?.trim()
          ? `· 장소: ${data.locationName.trim()}${
              data.locationAddress?.trim() ? ` (${data.locationAddress.trim()})` : ""
            }`
          : null,
        data.feeAmount ? `· 의뢰비용: ${Number(data.feeAmount).toLocaleString("ko-KR")}원` : null,
      ]
        .filter(Boolean)
        .join("\n") +
      `\n\n아래 링크에서 수락 또는 거절해 주세요.\n${url}\n`,
  });

  // 문자 — 이메일은 선택 항목이라 미등록 전문가에게는 이게 유일한 연락 수단이다.
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  await sendEngagementSms({
    tenantId,
    senderUserId: user.id,
    expertId: data.expertId,
    body: buildEngagementRequestSms({
      tenantName: tenantRow?.name ?? "캐스트로그",
      programName: data.programName?.trim() || data.roleDescription,
      schedule,
      locationName: data.locationName?.trim() || null,
      url,
    }),
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  if (projectId) {
    revalidatePath(`/[tenantSlug]/projects/${projectId}`, "page");
  }
  return { ok: true, url };
}

/**
 * 섭외 전 일정 스크리닝 — 특정 일시 범위에 겹치는지만 1차 판독.
 * 자사 섭외는 내역 공개, 다른 회사 섭외·전문가 직접 등록 일정은 겹침 여부만(§4).
 */
export async function screenExpertAvailability(
  expertId: string,
  fromISO: string,
  toISO: string
): Promise<ScreenResult> {
  return screenExpertSchedule(expertId, fromISO, toISO);
}

export type EngagementActionResult = { ok: true } | { ok: false; error: string };

/**
 * 섭외 취소 (단계 29 — 대표 피드백 ③)
 *  - 회수(requested): 전문가 응답 전 요청 회수. 사유 선택.
 *  - 긴급 취소(accepted): 계약 성립 후 취소. 사유 필수 + 전사 긴급 알림 발생.
 * 두 경우 모두 취소 내역(engagement_cancellations)에 기록한다.
 */
export async function cancelEngagement(
  engagementId: string,
  reason?: string
): Promise<EngagementActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("engagementCancel", user))) {
    return { ok: false, error: execDeniedMessage("engagementCancel") };
  }

  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, expert_id, project_id, experts (name)")
    .eq("id", engagementId)
    .maybeSingle();

  if (
    !engagement ||
    !["requested", "accepted"].includes(engagement.status)
  ) {
    return { ok: false, error: "취소할 수 없는 섭외입니다." };
  }

  // 부PM 실행 게이트 — 프로젝트에 붙은 섭외만 대상(미연결 건은 PM이 없다).
  if (engagement.project_id) {
    const deputyGate = await gateDeputyAction({
      projectId: engagement.project_id,
      actionType: "engagement.cancel",
      targetId: engagement.id,
    });
    if (!deputyGate.ok) return { ok: false, error: deputyGate.error };
  }

  const urgent = engagement.status === "accepted";
  const trimmedReason = reason?.trim() || null;
  if (urgent && !trimmedReason) {
    return {
      ok: false,
      error: "계약 성립 후 긴급 취소는 사유 입력이 필수입니다.",
    };
  }

  // 상태 전환 (경합 방지 — 조회 시점 상태를 그대로 가드)
  const { data: updated, error } = await supabase
    .from("expert_engagements")
    .update({ status: "canceled" })
    .eq("id", engagementId)
    .eq("status", engagement.status)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "이미 처리되어 취소할 수 없습니다." };
  }

  // 코드넘버 자리를 다시 미섭외로 되돌린다.
  // 이게 없으면 취소한 자리에 다른 전문가를 영영 붙일 수 없다.
  await releasePositionsForEngagement(engagementId);

  // 취소 내역 기록
  await supabase.from("engagement_cancellations").insert({
    tenant_id: tenantId,
    engagement_id: engagementId,
    expert_id: engagement.expert_id,
    project_id: engagement.project_id,
    prior_status: engagement.status,
    is_urgent: urgent,
    reason: trimmedReason,
    canceled_by: user.id,
  });

  // 긴급 취소 → 전사 알림 (대시보드 배너) — 한 줄: 프로젝트·세션(일자)·전문가·PM
  // (기획 확정 2026-08-23 — 사유는 배너에 싣지 않는다. 취소 내역에 남는다)
  if (urgent) {
    const expertName = engagement.experts?.name ?? "전문가";
    const title = await buildUrgentCancelAlertTitle({
      engagementId,
      expertName,
    });
    await supabase.from("tenant_alerts").insert({
      tenant_id: tenantId,
      severity: "urgent",
      category: "engagement_cancel",
      title,
      body: null,
      resource_type: "expert_engagement",
      resource_id: engagementId,
      created_by: user.id,
    });
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: urgent ? "engagement.urgent_cancel" : "engagement.cancel",
    resource_type: "expert_engagement",
    resource_id: engagementId,
    after_data: { prior_status: engagement.status, is_urgent: urgent },
  });

  // 섭외 이력 — 회수·긴급 취소를 담당자 이름으로 기록
  await logEngagementEvent({
    tenantId,
    engagementId,
    type: urgent ? "urgent_canceled" : "canceled",
    actorKind: "staff",
    actorLabel: await staffActorLabel(user.id),
    note: trimmedReason,
    isPractice: await isPracticeMode(),
  });

  // 통합 알림함 — 전문가에게 섭외 취소/회수 알림
  await notifyExpert({
    expertId: engagement.expert_id,
    category: "engagement_cancelled",
    title: urgent
      ? "계약 성립된 섭외가 취소되었습니다"
      : "섭외 요청이 회수되었습니다",
    body: trimmedReason ?? undefined,
    link: "/expert/engagements",
    tenantId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  if (engagement.project_id) {
    revalidatePath(`/[tenantSlug]/projects/${engagement.project_id}`, "page");
  }
  return { ok: true };
}


/**
 * 수동 섭외 완료 (기획 확정 2026-08-23) — 전화 등으로 수락을 직접 확인한 경우
 * 담당자가 '섭외 완료(수락서 생성)'로 처리한다. 자동 동의와 같은 경로
 * (계약 성립 → 수락서 자동 생성 → 자리 확정)를 타되, 실행자는 담당자로 남는다.
 */
export async function manualAcceptEngagement(
  engagementId: string,
  note?: string
): Promise<EngagementActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  // 섭외요청 실행과 같은 축 — 요청을 보낼 수 있는 사람이 완료 처리도 한다
  if (!(await canExecTenant("engagementRequest", user))) {
    return { ok: false, error: execDeniedMessage("engagementRequest") };
  }

  // 자사 건인지 확인 — RLS에 더해 tenant_id를 명시한다. 담당자가 다른 회사의
  // 전문가 본인이기도 하면 RLS의 본인 조건으로도 행이 보이는데, 그 경로로
  // 타사 건을 '담당자 수동 처리'로 기록하게 두면 안 된다.
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, project_id")
    .eq("id", engagementId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!engagement) return { ok: false, error: "섭외 건을 찾을 수 없습니다." };
  if (engagement.status !== "requested") {
    return { ok: false, error: "회신 대기 중인 건만 수동 완료할 수 있습니다." };
  }

  // 부PM 실행 게이트 — 계약 성립 행위라 취소와 같은 수준으로 PM 승인을 거친다.
  // (프로젝트에 붙은 건만 대상 — 미연결 건은 PM이 없다)
  if (engagement.project_id) {
    const deputyGate = await gateDeputyAction({
      projectId: engagement.project_id,
      actionType: "engagement.manual_accept",
      targetId: engagement.id,
    });
    if (!deputyGate.ok) return { ok: false, error: deputyGate.error };
  }

  const actorName = await staffActorLabel(user.id);
  const result = await applyEngagementResponse(
    engagementId,
    "accepted",
    note?.trim() ? `[수동 처리] ${note.trim()}` : "[수동 처리 — 전화 등 직접 확인]",
    null,
    { userId: user.id, role, name: actorName }
  );
  if (!result.ok) return result;

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true };
}

export type EngagementEventRow = {
  id: string;
  label: string;
  actorLabel: string;
  actorKind: string;
  note: string | null;
  createdAt: string;
};

/** 섭외 이력 조회 — 후보 행의 '이력' 버튼 (자사분만, RLS) */
export async function getEngagementEvents(
  engagementId: string
): Promise<
  { ok: true; rows: EngagementEventRow[] } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !tenantIdFromUser(user)) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  const { data, error } = await supabase
    .from("engagement_events")
    .select("id, event_type, actor_label, actor_kind, note, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });
  if (error) {
    return { ok: false, error: "이력을 불러오지 못했습니다. 마이그레이션 미적용일 수 있습니다." };
  }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      label:
        ENGAGEMENT_EVENT_LABELS[r.event_type as EngagementEventType] ??
        r.event_type,
      actorLabel: r.actor_label,
      actorKind: r.actor_kind,
      note: r.note,
      createdAt: r.created_at,
    })),
  };
}
