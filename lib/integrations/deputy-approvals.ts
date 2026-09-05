import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import {
  DEPUTY_GATED_ACTIONS,
  deputyActionLabel,
  type DeputyGatedAction,
} from "@/lib/integrations/deputy-actions";
import { recordActionDenial } from "@/lib/monitoring/action-denials";

/**
 * 부PM 실행 게이트 (공통 기반 — approvals 모듈과 무관)
 *
 * 부PM이 게이트 대상 작업을 실행하려 하면, 미리 받아 둔 PM 승인 1건을 소진한다.
 * 승인이 없으면 실행을 막고 '승인 요청' 경로를 안내한다. PM·대표·이사·담당자는
 * 이 게이트를 지나지 않는다 — 게이트는 부PM에게만 걸린다.
 *
 * 소진(consume)은 실행 직전에 한다. 실행이 실패하면 승인이 이미 소진된 상태가
 * 되는데, 이는 의도한 쪽이다: 되돌리기 어려운 실행이 부분적으로 나갔는지 알 수
 * 없는 상태에서 승인을 되살리면 같은 승인으로 두 번 나갈 수 있다.
 */

export type DeputyGateResult =
  | { ok: true; consumedRequestId: string | null }
  | { ok: false; error: string; needsPmApproval?: true };

type Context = {
  userId: string;
  tenantId: string;
  assignmentRole: string | null;
};

async function loadContext(projectId: string): Promise<Context | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return null;

  const { data: assignment } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    tenantId,
    assignmentRole: assignment?.assignment_role ?? null,
  };
}

/** 이 세션이 해당 프로젝트에서 부PM인가 (게이트 적용 대상인가). */
export async function isDeputyPm(projectId: string): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const ctx = await loadContext(projectId);
  return ctx?.assignmentRole === "deputy_pm";
}

/**
 * 실행 게이트. 부PM이 아니면 그대로 통과한다.
 * 부PM이면 승인 1건을 찾아 소진하고, 없으면 막는다.
 */
export async function gateDeputyAction(input: {
  projectId: string;
  actionType: DeputyGatedAction;
  targetId: string | null;
}): Promise<DeputyGateResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const ctx = await loadContext(input.projectId);
  if (!ctx) return { ok: false, error: "로그인이 필요합니다." };
  if (ctx.assignmentRole !== "deputy_pm") {
    return { ok: true, consumedRequestId: null };
  }

  const supabase = createClient();
  let query = supabase
    .from("project_action_requests")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("action_type", input.actionType)
    .eq("status", "approved")
    .is("consumed_at", null);
  query = input.targetId
    ? query.eq("target_id", input.targetId)
    : query.is("target_id", null);

  const { data: approval } = await query
    .order("decided_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!approval) {
    const message = `부PM이 ‘${deputyActionLabel(
      input.actionType
    )}’을 실행하려면 PM 승인이 먼저 필요합니다. 승인 요청을 보낸 뒤 다시 시도하세요.`;
    // 모니터링 창이 열려 있으면 피드에 자동 기록 (규칙 거부 가시화)
    await recordActionDenial({
      kind: `deputy:${input.actionType}`,
      message,
      resourceType: "project",
      resourceId: input.projectId,
    });
    return { ok: false, needsPmApproval: true, error: message };
  }

  // 소진은 조건부 UPDATE로 — 동시에 두 번 눌러도 한 번만 통과한다.
  const { data: consumed } = await supabase
    .from("project_action_requests")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approval.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();

  if (!consumed) {
    return {
      ok: false,
      needsPmApproval: true,
      error: "승인이 이미 사용되었습니다. PM 승인을 다시 받아 주세요.",
    };
  }
  return { ok: true, consumedRequestId: consumed.id };
}

export type CreateRequestResult = { ok: true } | { ok: false; error: string };

/** 부PM이 PM에게 실행 승인을 요청한다. */
export async function createDeputyActionRequest(input: {
  projectId: string;
  actionType: DeputyGatedAction;
  targetId: string | null;
  note: string;
}): Promise<CreateRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const ctx = await loadContext(input.projectId);
  if (!ctx) return { ok: false, error: "로그인이 필요합니다." };
  if (ctx.assignmentRole !== "deputy_pm") {
    return {
      ok: false,
      error: "부PM만 보낼 수 있는 요청입니다. 바로 실행하세요.",
    };
  }

  const supabase = createClient();

  // 같은 대상에 대해 미처리 요청이 있으면 중복 신청하지 않는다.
  let openQuery = supabase
    .from("project_action_requests")
    .select("id, status")
    .eq("project_id", input.projectId)
    .eq("action_type", input.actionType)
    .in("status", ["pending", "approved"])
    .is("consumed_at", null);
  openQuery = input.targetId
    ? openQuery.eq("target_id", input.targetId)
    : openQuery.is("target_id", null);
  const { data: open } = await openQuery.limit(1).maybeSingle();
  if (open) {
    return {
      ok: false,
      error:
        open.status === "approved"
          ? "이미 승인된 건이 있습니다. 그대로 실행하세요."
          : "이미 PM 승인 대기 중인 요청이 있습니다.",
    };
  }

  const { error } = await supabase.from("project_action_requests").insert({
    tenant_id: ctx.tenantId,
    project_id: input.projectId,
    action_type: input.actionType,
    // 대상 없는 요청(일괄 발송 등)은 프로젝트 단위 승인이다 — 자리별 승인과
    // 호환되지 않는다 (리뷰 L6)
    target_type: input.targetId
      ? DEPUTY_GATED_ACTIONS[input.actionType].targetType
      : "project",
    target_id: input.targetId,
    request_note: input.note.trim() || null,
    requested_by: ctx.userId,
  });
  if (error) return { ok: false, error: "요청을 저장하지 못했습니다." };
  return { ok: true };
}
