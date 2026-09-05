import "server-only";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { isPracticeMode } from "@/lib/practice/server";
import {
  logEngagementEvent,
  staffActorLabel,
} from "@/lib/integrations/engagement-events";
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
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";

export type RequestFromPositionResult =
  | { ok: true; url: string; engagementId: string }
  | { ok: false; error: string; needsPmApproval?: true };


export type RequestFromPositionInput = {
  positionId: string;
  expertId: string;
  programName?: string;
  eventSummary?: string;
  specialNotes?: string;
  message?: string;
  responseDeadline?: string;
  /** 발송 수단 — 일괄 발송에서 지정한다. 없으면 문자·이메일 모두 */
  channel?: "sms" | "email" | "both";
  /**
   * 건별 발송(문자·메일·포털 알림)을 억제한다 — 묶음 섭외(기획 2026-08-30,
   * 20번)에서 호출자가 전문가 단위로 1건만 보내기 위해 쓴다. 섭외 건 생성·
   * 감사로그·이력 기록은 그대로 남는다.
   */
  suppressSend?: boolean;
};

/**
 * 넘버링코드(포지션) 기준 섭외요청 — 슬롯의 일정·역할·비용·장소를 그대로 승계한다.
 * 성공 시 포지션이 'requested'로 전환되고 생성된 섭외건과 연결된다.
 *
 * 서버 전용 코어. 화면이 부르는 서버 액션(positions/[positionId]/position-actions)은
 * 이 함수를 부PM 게이트 '건별'로 감싸고, 일괄 발송(dispatchProjectEngagements)은
 * **프로젝트 단위 승인 1건**을 먼저 소진한 뒤 건별 게이트를 건너뛴다 — 자리마다
 * 승인을 요구하면 부PM은 일괄 발송을 사실상 쓸 수 없다 (E2E 검수 P2-6).
 * 이 옵션은 "use server" 파일에 두지 않는다 — 클라이언트가 직접 넘길 수 없어야 한다.
 */
export async function requestEngagementForPositionCore(
  input: RequestFromPositionInput,
  options: { deputyGate: "per_position" | "skip" } = { deputyGate: "per_position" }
): Promise<RequestFromPositionResult> {
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
  if (!(await canExecTenant("engagementRequest", user))) {
    return { ok: false, error: await deniedExec("engagementRequest") };
  }

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, slot_id, status, code, expected_fee")
    .eq("id", input.positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  // 임의 배정된 자리에서 일괄 발송으로 나가는 것이 기본 경로다.
  // 배정 없이 바로 보내는 경로(open)도 남겨 둔다 — 급한 한 자리 보충에 쓴다.
  if (position.status !== "open" && position.status !== "assigned") {
    return { ok: false, error: "이미 섭외가 진행 중이거나 확정된 인원입니다." };
  }

  // period_end_date(컨설팅 수행 종료일 — 34번)는 42703 한정 폴백 (§14-10)
  let slotEndsOn: string | null = null;
  const slotResult = await supabase
    .from("engagement_slots")
    .select(
      "id, project_id, slot_date, starts_time, ends_time, role_type, session_name, role_description, fee_amount, location_name, location_address, period_end_date"
    )
    .eq("id", position.slot_id)
    .maybeSingle();
  let slot = slotResult.data;
  if (slotResult.error?.code === "42703") {
    const { data: legacySlot } = await supabase
      .from("engagement_slots")
      .select(
        "id, project_id, slot_date, starts_time, ends_time, role_type, session_name, role_description, fee_amount, location_name, location_address"
      )
      .eq("id", position.slot_id)
      .maybeSingle();
    slot = legacySlot ? { ...legacySlot, period_end_date: null } : null;
  }
  if (!slot) return { ok: false, error: "슬롯을 찾을 수 없습니다." };
  // 컨설팅 세션은 수행기간(시작~종료)이 계약 기간이다 (리뷰 P2-1) —
  // 섭외요청·수락서·전문가 화면·일정충돌 판정 전부 이 기간을 쓴다
  slotEndsOn = slot.period_end_date ?? slot.slot_date;

  // 섭외계획 품의 게이트 (approvals 모듈 활성 테넌트만)
  const modules = await getTenantModules();
  const planGate = await assertEngagementAllowed(
    slot.project_id,
    modules.approvals,
    slot.id // 부분 상신 계획이면 계획에 담긴 세션만 통과 (기획 2026-08-30 — 22번)
  );
  if (!planGate.ok) return planGate;

  // 부PM 실행 게이트 — PM 승인 1건을 소진한다. PM·대표·이사는 그대로 통과.
  // 일괄 발송은 호출자가 프로젝트 단위 승인을 이미 소진했으므로 건너뛴다.
  if (options.deputyGate === "per_position") {
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
  }

  // 활성 연결 확인
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", input.expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 이 경로로 섭외할 수 있습니다 (규칙). 미연결 전문가는 '섭외후보 등록' 탭에서 탐색·배정하면 관계가 자동 생성됩니다." };
  }

  // 이용 중지 전문가에게는 신규 섭외를 보내지 않는다 — 기존 연결이 있어도
  // 중지 후 새 요청은 막는다 (관리모드 중지, 리뷰 3). 조회 실패는 통과(§14-10)
  {
    const { data: activeCheck, error: activeError } = await createAdminClient()
      .from("experts")
      .select("is_active")
      .eq("id", input.expertId)
      .maybeSingle();
    if (!activeError && activeCheck && activeCheck.is_active === false) {
      return {
        ok: false,
        error:
          "플랫폼에서 이용이 중지된 전문가입니다 (규칙). 다른 후보를 선택해 주세요.",
      };
    }
  }

  const token = generateLinkToken();
  const expiresAtIso = (input.responseDeadline
    ? new Date(input.responseDeadline)
    : new Date(Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
  ).toISOString();
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
      // 결재받은 후보별 예정가가 곧 의뢰비용이다 — 세션 1인 비용은 레거시 폴백.
      // 여기서 끊기면 문자·/e·수락서·지급 품의까지 금액이 비어 나간다 (E2E 검수 P1-2)
      fee_amount: position.expected_fee ?? slot.fee_amount,
      starts_on: slot.slot_date,
      ends_on: slotEndsOn,
      starts_time: slot.starts_time,
      ends_time: slot.ends_time,
      location_name: slot.location_name,
      location_address: slot.location_address,
      event_summary: input.eventSummary?.trim() || null,
      special_notes: input.specialNotes?.trim() || null,
      token_hash: hashLinkToken(token),
      token_expires_at: expiresAtIso,
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (error || !engagement) {
    return { ok: false, error: "섭외 요청 생성에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }

  // 행수 확인(CAS) — 두 담당자가 동시에 보내면 뒤의 것이 조용히 성공해
  // 같은 자리에 섭외건 2개·문자 2회가 나가던 결함 (검수 B4). 0행이면 이미
  // 다른 요청이 자리를 잡은 것이므로, 방금 만든 섭외건을 회수하고 알린다.
  const { data: linked, error: linkError } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "requested",
      engagement_id: engagement.id,
      expert_id: input.expertId,
    })
    .eq("id", position.id)
    .in("status", ["open", "assigned"])
    .select("id")
    .maybeSingle();
  if (linkError || !linked) {
    await supabase
      .from("expert_engagements")
      .update({ status: "canceled" })
      .eq("id", engagement.id)
      .eq("status", "requested");
    return {
      ok: false,
      error: linkError
        ? "자리 연결에 실패해 방금 만든 섭외 요청을 회수했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요."
        : "그 사이 다른 담당자가 이 자리에 먼저 요청을 보냈습니다. 방금 만든 요청은 회수했으니 새로고침 후 확인해 주세요.",
    };
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

  // 섭외 이력 — 발송 담당자 이름으로 기록. 라이트 모드는 발송이 없으므로
  // "발송"으로 남기면 거짓 기록이 된다 (검수 B7) — 사실을 note에 밝힌다.
  await logEngagementEvent({
    tenantId,
    engagementId: engagement.id,
    type: "requested",
    actorKind: "staff",
    actorLabel: await staffActorLabel(user.id),
    note: (await isExpertsLite()) ? "발송 없이 기록됨 — 라이트 모드" : undefined,
    isPractice: await isPracticeMode(),
  });

  if (!input.suppressSend)
  await notifyExpert({
    expertId: input.expertId,
    category: "engagement_request",
    title: "새로운 섭외 요청이 도착했습니다",
    body: [
      input.programName?.trim() || null,
      formatEventSchedule(
        slot.slot_date,
        slotEndsOn,
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
    slotEndsOn,
    slot.starts_time,
    slot.ends_time
  );
  const channel = input.channel ?? "both";
  const useEmail = !input.suppressSend && (channel === "email" || channel === "both");
  const useSms = !input.suppressSend && (channel === "sms" || channel === "both");

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
        `· 회신 마감: ${new Date(expiresAtIso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지`,
      ]
        .filter(Boolean)
        .join("\n") +
      `\n\n아래 링크에서 수락 또는 거절해 주세요.\n${url}\n` +
      `문의는 이 메일에 회신하시거나 요청 기업 담당자에게 연락해 주세요.\n`,
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
      // 폴백은 중립 표기 — 캐스트로그 브랜드가 회사 자리에 나오면 §16 위반
      tenantName: tenant?.name ?? "기업",
      programName: input.programName?.trim() || null,
      schedule,
      locationName: slot.location_name,
      feeAmount: slot.fee_amount,
      deadline: expiresAtIso,
      url,
    }),
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, url, engagementId: engagement.id };
}

