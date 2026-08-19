"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { matchApprovalRule, createApprovalWithSteps } from "@/lib/approvals/engine";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import {
  getProjectEngagementState,
  buildEngagementPlanDraft,
} from "@/lib/integrations/project-engagement";
import { requestEngagementForPosition } from "./positions/[positionId]/position-actions";

const MANAGER_ROLES = ["org_admin", "manager"];

export type PositionAssignResult = { ok: true } | { ok: false; error: string };

type Session = { userId: string; tenantId: string; role: string };

async function requireManager(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
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
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "배정 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

/**
 * 코드넘버에 전문가를 **임의 배정**한다.
 *
 * 아직 아무에게도 나가지 않는 내부 결정이다. 전문가는 이 사실을 모른다 —
 * 알리는 것은 품의 승인 뒤 '섭외 진행'에서 한 번에 한다. 그래서 여기서는
 * 섭외 건(expert_engagements)을 만들지 않는다.
 */
export async function assignExpertToPosition(input: {
  positionId: string;
  expertId: string;
}): Promise<PositionAssignResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();

  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, status, slot_id")
    .eq("id", input.positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (position.status !== "open" && position.status !== "assigned") {
    return {
      ok: false,
      error: "이미 섭외 요청이 나갔거나 확정된 자리입니다. 배정을 바꿀 수 없습니다.",
    };
  }

  // 활성 연결이 있는 전문가만 (RLS + 명시 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", input.expertId)
    .eq("status", "active")
    .maybeSingle();
  if (!link) {
    return { ok: false, error: "자사와 활성 연결이 있는 전문가만 배정할 수 있습니다." };
  }

  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "assigned",
      assigned_expert_id: input.expertId,
      assigned_at: new Date().toISOString(),
      assigned_by: auth.session.userId,
    })
    .eq("id", input.positionId);
  if (error) return { ok: false, error: "배정에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "engagement_position.assign",
    resource_type: "engagement_slot_position",
    resource_id: input.positionId,
    after_data: { expert_id: input.expertId },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 배정 취소 — 요청 전에만 가능하다 */
export async function unassignPosition(
  positionId: string
): Promise<PositionAssignResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: position } = await supabase
    .from("engagement_slot_positions")
    .select("id, status")
    .eq("id", positionId)
    .maybeSingle();
  if (!position) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (position.status !== "assigned") {
    return { ok: false, error: "임의 배정 상태에서만 해제할 수 있습니다." };
  }

  const { error } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "open",
      assigned_expert_id: null,
      assigned_at: null,
      assigned_by: null,
    })
    .eq("id", positionId);
  if (error) return { ok: false, error: "해제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export type PlanSubmitResult =
  | { ok: true; approvalId: string | null; autoApproved: boolean }
  | { ok: false; error: string };

/**
 * 섭외 품의서 자동 작성 + 상신.
 *
 * 배정이 100% 찼을 때만 열린다 — 반쯤 채운 명단으로 결재를 올리면 결재자가
 * 무엇을 승인하는지 알 수 없다.
 *
 * approvals 모듈을 쓰지 않는 회사에서는 결재 자체가 없으므로 바로 '결재 완료'로
 * 넘긴다. 없는 절차를 기다리게 만들면 아무것도 진행되지 않는다.
 */
export async function submitEngagementPlan(
  projectId: string
): Promise<PlanSubmitResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const state = await getProjectEngagementState(projectId);
  if (!state) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  if (state.stage !== "assigning") {
    return { ok: false, error: "이미 품의가 상신되었거나 다음 단계로 넘어갔습니다." };
  }
  if (!state.fullyAssigned) {
    return {
      ok: false,
      error: `아직 배정되지 않은 자리가 ${state.open}개 있습니다. 전부 배정한 뒤 상신하세요.`,
    };
  }

  const draft = await buildEngagementPlanDraft(projectId);
  if (!draft) return { ok: false, error: "품의서를 만들지 못했습니다." };

  const modules = await getTenantModules();
  if (!modules.approvals) {
    await supabase
      .from("projects")
      .update({ engagement_stage: "plan_approved" })
      .eq("id", projectId);
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true, approvalId: null, autoApproved: true };
  }

  // 전결규정이 있으면 그 라인, 없으면 직급 체계를 따라 위로 올린다
  const rule = await matchApprovalRule("project", draft.amount);
  const line =
    rule ?? (await buildGradeEscalationLine(auth.session.userId, draft.amount));
  if (!line || line.steps.length === 0) {
    return {
      ok: false,
      error:
        "결재선을 정할 수 없습니다. 상위 결재자가 없거나 전결규정이 등록되지 않았습니다.",
    };
  }

  const created = await createApprovalWithSteps({
    tenantId: auth.session.tenantId,
    requesterUserId: auth.session.userId,
    title: draft.title,
    body: draft.body,
    approvalType: "project",
    amount: draft.amount,
    projectId,
    appliedRuleId: "ruleId" in line ? line.ruleId : null,
    steps: line.steps,
  });
  if (!created.ok) return { ok: false, error: created.error };

  await supabase
    .from("projects")
    .update({
      engagement_stage: "plan_review",
      engagement_plan_approval_id: created.approvalId,
    })
    .eq("id", projectId);

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "engagement_plan.submit",
    resource_type: "project",
    resource_id: projectId,
    after_data: { approval_id: created.approvalId, amount: draft.amount },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true, approvalId: created.approvalId, autoApproved: false };
}

export type DispatchChannel = "sms" | "email" | "both";

export type DispatchResult =
  | { ok: true; sent: number; failed: { code: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * 섭외 진행 — 배정된 전원에게 한 번에 섭외 요청을 보낸다.
 *
 * 결재가 끝난 뒤에만 열린다. 한 명씩 보내지 않는 이유는 실제 일이 그렇기
 * 때문이다: 같은 사업의 전문가들에게 같은 안내를 같은 마감으로 보낸다.
 *
 * 한 명이 실패해도 나머지는 보낸다. 전체를 되돌리면 이미 나간 사람에게 두 번
 * 가거나, 아무도 못 받는다. 실패한 자리는 그대로 배정 상태로 남고 화면에
 * 이유와 함께 표시된다 — 조용히 넘어가지 않는다.
 */
export async function dispatchProjectEngagements(input: {
  projectId: string;
  channel: DispatchChannel;
  /** 회신 마감일시 (ISO). 없으면 기본 기한 */
  deadline?: string;
  programName?: string;
  eventSummary?: string;
  memo?: string;
}): Promise<DispatchResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const state = await getProjectEngagementState(input.projectId);
  if (!state) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (state.stage !== "plan_approved") {
    return {
      ok: false,
      error:
        state.stage === "assigning"
          ? "섭외 품의를 먼저 상신·승인받아야 합니다."
          : state.stage === "plan_review"
            ? "섭외 품의가 결재 진행 중입니다. 승인 후 발송할 수 있습니다."
            : "이미 섭외 요청이 발송되었습니다.",
    };
  }

  const supabase = createClient();

  const { data: slots } = await supabase
    .from("engagement_slots")
    .select("id")
    .eq("project_id", input.projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select("id, code, assigned_expert_id, status")
        .in("slot_id", slotIds)
        .eq("status", "assigned")
    : { data: [] };

  const targets = (positions ?? []).filter((p) => p.assigned_expert_id);
  if (targets.length === 0) {
    return { ok: false, error: "발송할 배정 건이 없습니다." };
  }

  const failed: { code: string; reason: string }[] = [];
  let sent = 0;

  for (const position of targets) {
    const result = await requestEngagementForPosition({
      positionId: position.id,
      expertId: position.assigned_expert_id!,
      programName: input.programName,
      eventSummary: input.eventSummary,
      specialNotes: input.memo,
      responseDeadline: input.deadline,
      channel: input.channel,
    });
    if (result.ok) sent += 1;
    else failed.push({ code: position.code, reason: result.error });
  }

  if (sent === 0) {
    return {
      ok: false,
      error: `한 건도 발송되지 않았습니다. (${failed[0]?.reason ?? "원인 미상"})`,
    };
  }

  await supabase
    .from("projects")
    .update({
      engagement_stage: "requesting",
      engagement_channel: input.channel,
      engagement_deadline: input.deadline ?? null,
      engagement_requested_at: new Date().toISOString(),
    })
    .eq("id", input.projectId);

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "engagement.dispatch_batch",
    resource_type: "project",
    resource_id: input.projectId,
    after_data: { sent, failed: failed.length, channel: input.channel },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, sent, failed };
}
