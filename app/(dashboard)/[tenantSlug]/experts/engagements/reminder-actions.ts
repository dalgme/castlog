"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { execDeniedMessage } from "@/lib/auth/exec-permissions";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { buildPublicLink } from "@/lib/routing/links";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { sendEngagementSms } from "@/lib/integrations/engagement-sms";
import {
  logEngagementEvent,
  staffActorLabel,
} from "@/lib/integrations/engagement-events";
import { notifyExpert } from "@/lib/experts/notifications";
import { logAudit } from "@/lib/audit/log";
import { blockInPractice } from "@/lib/practice/server";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";

export type ReminderResult = { ok: true } | { ok: false; error: string };


/**
 * 미회신 섭외 재안내 (리마인드 · 링크 재발급).
 *
 * 새 섭외건을 만들지 않는다 — 같은 건에 대해 동의 링크만 다시 발급해 보낸다.
 * 새 건을 만들면 전문가 화면에 같은 요청이 두 개로 보이고 자리(포지션)도 두 번
 * 잠긴다.
 *
 * **이전 링크는 이때 무효가 된다.** 토큰은 해시로만 저장하므로(원문 미보관)
 * 기존 링크를 그대로 다시 보낼 방법이 없다. 되살릴 수 없는 값을 되살린 척하는
 * 대신, 새 링크를 발급하고 문자에 그 사실을 밝힌다.
 *
 * 회신 마감도 함께 연장한다 — 만료가 임박한 채로 재안내하면 안내받고도 못 누른다.
 *
 * 업무연락이므로 광고 수신동의와 무관하다 (CLAUDE.md §5-1).
 */
export async function remindEngagement(
  engagementId: string
): Promise<ReminderResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const practice = await blockInPractice("sending");
  if (!practice.ok) return practice;

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
  if (!(await canExecTenant("acceptanceSend", user))) {
    return { ok: false, error: execDeniedMessage("acceptanceSend") };
  }

  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select(
      "id, expert_id, project_id, status, program_name, starts_on, starts_time, ends_time, location_name, token_expires_at"
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { ok: false, error: "섭외 건을 찾을 수 없습니다." };
  if (engagement.status !== "requested") {
    return { ok: false, error: "회신 대기 중인 건만 재안내할 수 있습니다." };
  }

  // 부PM 실행 게이트 — 외부로 나가는 발송이다.
  if (engagement.project_id) {
    const gate = await gateDeputyAction({
      projectId: engagement.project_id,
      actionType: "engagement.session_sms",
      targetId: null,
    });
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  // 동의 링크 재발급 — 토큰 원문은 저장하지 않으므로 기존 링크를 재사용할 수 없다.
  // 상태를 다시 확인하며 갱신한다(그 사이 수락됐으면 덮어쓰지 않는다).
  const token = generateLinkToken();
  const expiresAt = new Date(
    Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 3600 * 1000
  ).toISOString();
  const { data: updated } = await supabase
    .from("expert_engagements")
    .update({ token_hash: hashLinkToken(token), token_expires_at: expiresAt })
    .eq("id", engagementId)
    .eq("status", "requested")
    .select("id")
    .maybeSingle();
  if (!updated) {
    return { ok: false, error: "그 사이 상태가 바뀌었습니다. 새로고침 후 확인해 주세요." };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const schedule = formatEventSchedule(
    engagement.starts_on,
    null,
    engagement.starts_time,
    engagement.ends_time
  );
  const deadline = new Date(expiresAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // 전문가 알림함에는 항상 남긴다(문자 설정이 없어도 전달은 되어야 한다).
  await notifyExpert({
    expertId: engagement.expert_id,
    category: "engagement_request",
    title: "[재안내] 섭외 요청에 회신이 필요합니다",
    body:
      `${tenant?.name ?? "기업"} · ${engagement.program_name ?? "섭외 요청"}` +
      `${schedule ? ` · ${schedule}` : ""} · 회신 마감 ${deadline}`,
    link: "/expert/engagements",
    tenantId,
  });

  await sendEngagementSms({
    tenantId,
    senderUserId: user.id,
    expertId: engagement.expert_id,
    body:
      `[재안내] ${tenant?.name ?? "기업"} 섭외 요청에 아직 회신이 없어 다시 안내드립니다.\n` +
      `아래 새 링크로 회신해 주세요(이전 링크는 사용할 수 없습니다).\n` +
      `${engagement.program_name ?? ""}${schedule ? `\n일정: ${schedule}` : ""}` +
      `${engagement.location_name ? `\n장소: ${engagement.location_name}` : ""}\n` +
      `회신 마감: ${deadline}\n` +
      buildPublicLink("engagementConsent", token),
  });

  await logAudit(supabase, user, {
    action: "engagement.remind",
    resourceType: "expert_engagements",
    resourceId: engagementId,
    afterData: { project_id: engagement.project_id },
  });

  await logEngagementEvent({
    tenantId,
    engagementId,
    type: "reminded",
    actorKind: "staff",
    actorLabel: await staffActorLabel(user.id),
  });

  revalidatePath("/[tenantSlug]/experts/engagements", "page");
  return { ok: true };
}
