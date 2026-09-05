"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { releasePositionsForEngagement } from "@/lib/integrations/engagement-lifecycle";
import { logEngagementEvent } from "@/lib/integrations/engagement-events";
import { refreshProjectEngagementStage } from "@/lib/integrations/project-engagement";
import { buildUrgentCancelAlertTitle } from "@/lib/integrations/urgent-cancellations";
// 취소 사유 목록은 lib/integrations/expert-cancel-reasons — "use server" 파일은
// async 함수만 내보낸다 (상수를 여기서 내보내면 클라이언트에서 배열이 아니게 된다)

export type ExpertCancelResult = { ok: true } | { ok: false; error: string };

/**
 * 전문가 본인의 긴급 취소 (확정 후).
 *
 * 확정된 참여를 전문가가 되돌리는 경로다. 기업 입장에서는 대체 인력을 급히
 * 구해야 하는 사건이므로, 회사 화면의 전사 긴급 알림과 재섭외 표시가 동시에
 * 켜진다 — 조용히 사라지는 취소를 만들지 않는다.
 *
 * service_role로 처리한다. 전문가 세션에는 테넌트 컨텍스트가 없어 취소 내역·
 * 전사 알림 테이블에 RLS로는 쓸 수 없다. 대상 검증은 '본인 건인가'로 한다.
 */
export async function cancelConfirmedEngagementByExpert(input: {
  engagementId: string;
  reason: string;
  detail?: string;
}): Promise<ExpertCancelResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "취소 사유를 선택해 주세요." };
  if ((input.detail ?? "").length > 500) {
    return { ok: false, error: "상세 사유는 500자 이내로 입력해 주세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: expert } = await supabase
    .from("experts")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가 프로필이 없습니다." };

  const admin = createAdminClient();
  const { data: engagement } = await admin
    .from("expert_engagements")
    .select("id, tenant_id, expert_id, project_id, status, is_practice")
    .eq("id", input.engagementId)
    .maybeSingle();
  if (!engagement || engagement.expert_id !== expert.id) {
    return { ok: false, error: "본인의 섭외 건만 취소할 수 있습니다." };
  }
  if (engagement.status !== "accepted") {
    return { ok: false, error: "확정된 참여만 취소할 수 있습니다." };
  }

  // 상태 전환 (경합 방지 — 조회 시점 상태를 그대로 가드)
  const { data: updated } = await admin
    .from("expert_engagements")
    .update({ status: "canceled" })
    .eq("id", input.engagementId)
    .eq("status", "accepted")
    .select("id")
    .maybeSingle();
  if (!updated) {
    return { ok: false, error: "이미 처리되어 취소할 수 없습니다." };
  }

  // 코드넘버 자리를 다시 미섭외로 되돌린다 — 이게 없으면 재섭외를 못 한다
  await releasePositionsForEngagement(input.engagementId);

  const fullReason = [`[전문가 취소 요청] ${reason}`, input.detail?.trim()]
    .filter(Boolean)
    .join(" — ");

  // canceled_by는 직원(users)을 가리키는 칼럼이다. 전문가 본인 취소는 비워 두고
  // 사유 앞머리로 주체를 남긴다.
  // admin 경로에는 JWT 연습 클레임이 없어 스탬프 트리거가 못 잡는다 —
  // 섭외 건의 모드를 그대로 명시한다 (연습 취소가 실모드 화면에 새면 안 된다)
  await admin.from("engagement_cancellations").insert({
    tenant_id: engagement.tenant_id,
    engagement_id: engagement.id,
    expert_id: expert.id,
    project_id: engagement.project_id,
    prior_status: "accepted",
    is_urgent: true,
    reason: fullReason,
    canceled_by: null,
    is_practice: engagement.is_practice,
  });

  // 배너는 한 줄: 프로젝트·세션(일자)·전문가·PM (기획 확정 2026-08-23 —
  // 사유는 배너에 싣지 않는다. 취소 내역·감사로그에 남는다)
  const alertTitle = await buildUrgentCancelAlertTitle({
    engagementId: engagement.id,
    expertName: expert.name,
  });
  await admin.from("tenant_alerts").insert({
    tenant_id: engagement.tenant_id,
    severity: "urgent",
    category: "engagement_cancel",
    title: alertTitle,
    body: null,
    resource_type: "expert_engagement",
    resource_id: engagement.id,
    created_by: null,
    is_practice: engagement.is_practice,
  });

  await admin.from("audit_logs").insert({
    tenant_id: engagement.tenant_id,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "engagement.urgent_cancel_by_expert",
    resource_type: "expert_engagement",
    resource_id: engagement.id,
    after_data: { reason: fullReason },
  });

  // 섭외 이력 — 전문가 본인의 긴급 취소도 타임라인에 남는다 (검수 B7)
  await logEngagementEvent({
    tenantId: engagement.tenant_id,
    engagementId: engagement.id,
    type: "urgent_canceled",
    actorKind: "expert",
    actorLabel: expert.name ?? "전문가",
    note: fullReason,
    isPractice: engagement.is_practice,
  });

  // 프로젝트를 요청 단계로 되돌린다 — 재섭외 버튼이 다시 열려야 한다
  if (engagement.project_id) {
    await refreshProjectEngagementStage(engagement.project_id);
  }

  revalidatePath("/expert/engagements");
  return { ok: true };
}
