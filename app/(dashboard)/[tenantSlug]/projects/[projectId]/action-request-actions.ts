"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { logAudit } from "@/lib/audit/log";
import {
  createDeputyActionRequest,
  type CreateRequestResult,
} from "@/lib/integrations/deputy-approvals";
import {
  isDeputyGatedAction,
  deputyActionLabel,
} from "@/lib/integrations/deputy-actions";

export type ActionRequestResult = { ok: true } | { ok: false; error: string };

/** 부PM → PM 실행 승인 요청 생성. */
export async function submitActionRequest(input: {
  tenantSlug: string;
  projectId: string;
  actionType: string;
  targetId: string | null;
  note: string;
}): Promise<CreateRequestResult> {
  if (!isDeputyGatedAction(input.actionType)) {
    return { ok: false, error: "승인이 필요한 작업이 아닙니다." };
  }
  const result = await createDeputyActionRequest({
    projectId: input.projectId,
    actionType: input.actionType,
    targetId: input.targetId,
    note: input.note,
  });
  if (result.ok) {
    revalidatePath(`/${input.tenantSlug}/projects/${input.projectId}`);
  }
  return result;
}

/**
 * PM(또는 대표·이사)의 승인·반려.
 * 자기 요청 승인 금지와 결정 권한은 DB 트리거가 최종 판정한다 — 여기서 막는 것은
 * 사용자에게 이유를 보여주기 위한 1차 확인이다.
 */
async function decide(
  requestId: string,
  tenantSlug: string,
  status: "approved" | "denied",
  note: string
): Promise<ActionRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return { ok: false, error: "로그인이 필요합니다." };

  const { data: request } = await supabase
    .from("project_action_requests")
    .select("id, project_id, action_type, requested_by, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (request.status !== "pending") {
    return { ok: false, error: "이미 처리된 요청입니다." };
  }
  if (request.requested_by === user.id) {
    return { ok: false, error: "자기 요청은 스스로 승인할 수 없습니다." };
  }

  const { data: updated, error } = await supabase
    .from("project_action_requests")
    .update({
      status,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: note.trim() || null,
      // 반려는 그 자리에서 닫는다 — 미처리 목록에 남지 않게 한다.
      consumed_at: status === "denied" ? new Date().toISOString() : null,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return {
      ok: false,
      error: "처리하지 못했습니다. PM 또는 대표·이사만 승인·반려할 수 있습니다.",
    };
  }

  await logAudit(supabase, user, {
    action:
      status === "approved"
        ? "project_action_request.approve"
        : "project_action_request.deny",
    resourceType: "project_action_requests",
    resourceId: requestId,
    afterData: {
      project_id: request.project_id,
      action: deputyActionLabel(request.action_type),
    },
  });

  revalidatePath(`/${tenantSlug}/projects/${request.project_id}`);
  return { ok: true };
}

export async function approveActionRequest(
  requestId: string,
  tenantSlug: string,
  note: string
): Promise<ActionRequestResult> {
  return decide(requestId, tenantSlug, "approved", note);
}

export async function denyActionRequest(
  requestId: string,
  tenantSlug: string,
  note: string
): Promise<ActionRequestResult> {
  return decide(requestId, tenantSlug, "denied", note);
}
