"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { isPracticeMode } from "@/lib/practice/server";
import {
  logEngagementEvent,
  staffActorLabel,
} from "@/lib/integrations/engagement-events";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { notifyExpert } from "@/lib/experts/notifications";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";
import {
  requestEngagementForPositionCore,
  type RequestFromPositionInput,
  type RequestFromPositionResult,
} from "@/lib/integrations/request-engagement";

export type {
  RequestFromPositionInput,
  RequestFromPositionResult,
} from "@/lib/integrations/request-engagement";

/**
 * 넘버링코드(포지션) 기준 섭외요청 — 화면(코드넘버 상세·후보 행)에서 부르는 서버
 * 액션. 부PM은 자리별 PM 승인 1건을 소진한다. 본체는 lib/integrations/
 * request-engagement (일괄 발송과 공용 — E2E 검수 P2-6).
 */
export async function requestEngagementForPosition(
  input: RequestFromPositionInput
): Promise<RequestFromPositionResult> {
  return requestEngagementForPositionCore(input, { deputyGate: "per_position" });
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
  // 자리 해제는 응답 전 요청만 함께 회수한다(accepted는 거부) — 회수 축과
  // 같은 위험도라 engagementWithdraw로 판정한다 (리뷰 3: 축 분리 정합)
  if (!(await canExecTenant("engagementWithdraw", user))) {
    return { ok: false, error: await deniedExec("engagementWithdraw") };
  }

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, code, status, engagement_id, expert_id, engagement_slots (project_id)")
    .eq("id", positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (position.status === "open") return { ok: true };

  const projectId = position.engagement_slots?.project_id ?? null;

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
      // 부PM 실행 게이트 — 진행 중 요청을 함께 회수하는 자리 해제는 회수
      // 버튼과 같은 효과다 (시뮬레이션 P4). 승인 1건을 소진하므로 실제 회수가
      // 일어나는 이 지점에서만 건다 — 상태 확인보다 앞이면 accepted 거부에도
      // 승인만 소진된다 (리뷰 3)
      if (projectId) {
        const deputyGate = await gateDeputyAction({
          projectId,
          actionType: "engagement.withdraw",
          targetId: position.engagement_id,
        });
        if (!deputyGate.ok) return { ok: false, error: deputyGate.error };
      }
      await supabase
        .from("expert_engagements")
        .update({ status: "canceled" })
        .eq("id", position.engagement_id)
        .eq("status", "requested");

      // 섭외 이력 — 자리 해제로 함께 회수된 사실을 남긴다 (검수 B7).
      // 이게 없으면 타임라인이 '요청됨'에서 끊긴 채 상태만 취소로 보인다.
      await logEngagementEvent({
        tenantId,
        engagementId: position.engagement_id,
        type: "canceled",
        actorKind: "staff",
        actorLabel: await staffActorLabel(user.id),
        note: `코드넘버 ${position.code} 자리 해제로 회수`,
        isPractice: await isPracticeMode(),
      });

      if (position.expert_id) {
        // project_id를 함께 남긴다 — 없으면 취소 내역의 프로젝트 컬럼이 비고
        // 코드 조회(getCanceledExpertByPositionCode)에도 안 잡힌다 (시뮬레이션 P4)
        await supabase.from("engagement_cancellations").insert({
          tenant_id: tenantId,
          engagement_id: position.engagement_id,
          expert_id: position.expert_id,
          project_id: projectId,
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
  if (error) return { ok: false, error: "해제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };

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
