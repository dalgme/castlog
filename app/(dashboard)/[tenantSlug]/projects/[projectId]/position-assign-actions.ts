"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { getProjectEngagementState } from "@/lib/integrations/project-engagement";
import {
  getActivePlan,
  buildPlanSnapshot,
} from "@/lib/integrations/engagement-plans";
import { submitEngagementPlan as submitPlanRecord } from "./plan-actions";
import {
  createEngagementAcceptance,
  copyProjectAttachmentsToAcceptance,
} from "@/lib/integrations/acceptance";
import { notifyExpert } from "@/lib/experts/notifications";
import { sendEngagementSms } from "@/lib/integrations/engagement-sms";
import {
  sendEngagementEmail,
  portalUrl,
} from "@/lib/integrations/engagement-email";
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

  const modules = await getTenantModules();
  if (!modules.approvals) {
    await supabase
      .from("projects")
      .update({ engagement_stage: "plan_approved" })
      .eq("id", projectId);
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true, approvalId: null, autoApproved: true };
  }

  /**
   * 품의는 **한 벌**만 만든다.
   *
   * 원래 이 버튼은 자체적으로 결재를 만들고 projects.engagement_stage만
   * 움직였고, 화면 아래 계획 패널은 engagement_plans(지문 게이트)로 따로
   * 결재를 만들었다 — 같은 행위의 상신 창구가 둘이라 어느 쪽으로 승인받아도
   * 반대쪽 잠금이 안 풀렸다(검수에서 확인된 이중 구현). 이제 이 버튼이
   * 계획 레코드 상신(plan-actions)에 위임하고, 단계 기계는 **같은 결재건**을
   * 바라본다. 승인 한 번에 지문 게이트와 단계가 함께 열린다.
   */
  const [activePlan, snapshot] = await Promise.all([
    getActivePlan(projectId),
    buildPlanSnapshot(projectId),
  ]);

  // 예전 패널 경로로 이미 승인·결재중인 계획이 있는 프로젝트 — 새 결재를
  // 만들지 않고 단계만 그 결재건에 연결한다 (기존 데이터 구제)
  if (
    activePlan?.status === "approved" &&
    activePlan.planSignature === snapshot.signature
  ) {
    await supabase
      .from("projects")
      .update({
        engagement_stage: "plan_approved",
        engagement_plan_approval_id: activePlan.approvalId,
      })
      .eq("id", projectId);
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true, approvalId: activePlan.approvalId, autoApproved: true };
  }
  if (activePlan?.status === "in_progress") {
    await supabase
      .from("projects")
      .update({
        engagement_stage: "plan_review",
        engagement_plan_approval_id: activePlan.approvalId,
      })
      .eq("id", projectId);
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    return { ok: true, approvalId: activePlan.approvalId, autoApproved: false };
  }

  const submitted = await submitPlanRecord(projectId, "");
  if (!submitted.ok) return submitted;
  const approvalId = submitted.approvalId ?? null;

  await supabase
    .from("projects")
    .update({
      engagement_stage: "plan_review",
      engagement_plan_approval_id: approvalId,
    })
    .eq("id", projectId);

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "engagement_plan.submit",
    resource_type: "project",
    resource_id: projectId,
    after_data: { approval_id: approvalId, amount: snapshot.plannedAmount },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true, approvalId, autoApproved: false };
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

export type AcceptanceSendResult =
  | {
      ok: true;
      sent: number;
      /** 이미 확인까지 끝난 건 — 다시 보내지 않는다 */
      skipped: number;
      attached: number;
      failed: { name: string; reason: string }[];
    }
  | { ok: false; error: string };

/**
 * 수락서 일괄 송신 — 전원 수락 후, 프로젝트의 전문가 전원에게 한 번에 보낸다.
 *
 * **수락서 자체는 파일로 나가지 않는다.** 캐스트로그 화면에서만 열린다. 문자·
 * 이메일은 '수락서가 도착했으니 캐스트로그에서 확인하라'는 안내일 뿐이다.
 * (사용자 확정 사항: 수락서는 화면으로만 볼 수 있도록 한다)
 *
 * 동봉 자료(공통·개별 첨부)는 이 시점에 각 수락서로 **스냅샷 복사**된다. 보낸
 * 문서는 보낸 그대로 남아야 하기 때문이다 — 프로젝트 첨부를 나중에 지워도
 * 이미 나간 수락서의 자료는 사라지지 않는다.
 *
 * 한 명이 실패해도 나머지는 보낸다(섭외 발송과 같은 원칙). 이미 확인까지 끝난
 * 수락서는 상태를 되돌리지 않고 건너뛴다.
 */
export async function sendAcceptanceLetters(input: {
  projectId: string;
  channel: DispatchChannel;
  memo?: string;
}): Promise<AcceptanceSendResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const state = await getProjectEngagementState(input.projectId);
  if (!state) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (state.stage !== "accepted_all" && state.stage !== "letters_sent") {
    return {
      ok: false,
      error:
        state.stage === "confirmed"
          ? "전원이 수락서 확인까지 마쳤습니다. 다시 보낼 필요가 없습니다."
          : "아직 전원이 섭외를 수락하지 않았습니다. 전원 수락 후 열립니다.",
    };
  }

  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const { data: slots } = await supabase
    .from("engagement_slots")
    .select("id")
    .eq("project_id", input.projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select("id, code, engagement_id, expert_id, status")
        .in("slot_id", slotIds)
        .eq("status", "filled")
    : { data: [] };

  // 코드넘버에 붙지 않은 수락 건도 같은 프로젝트의 전문가다 — 빠뜨리지 않는다
  const { data: looseEngagements } = await supabase
    .from("expert_engagements")
    .select("id, expert_id")
    .eq("project_id", input.projectId)
    .eq("status", "accepted");

  const byEngagement = new Map<string, string>();
  for (const p of positions ?? []) {
    if (p.engagement_id && p.expert_id) byEngagement.set(p.engagement_id, p.expert_id);
  }
  for (const e of looseEngagements ?? []) {
    if (!byEngagement.has(e.id)) byEngagement.set(e.id, e.expert_id);
  }

  const targets = Array.from(byEngagement, ([engagementId, expertId]) => ({
    engagementId,
    expertId,
  }));
  if (targets.length === 0) {
    return { ok: false, error: "송신할 수락 건이 없습니다." };
  }

  const { data: experts } = await supabase
    .from("experts")
    .select("id, name")
    .in(
      "id",
      targets.map((t) => t.expertId)
    );
  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", auth.session.tenantId)
    .maybeSingle();
  const tenantName = tenant?.name ?? "";

  const failed: { name: string; reason: string }[] = [];
  let sent = 0;
  let skipped = 0;
  let attached = 0;

  for (const target of targets) {
    const expertName = nameById.get(target.expertId) ?? "전문가";

    // 수락 시점에 이미 만들어졌지만, 없으면 여기서 만든다 (멱등)
    await createEngagementAcceptance(target.engagementId, "portal");

    const { data: acceptance } = await supabase
      .from("engagement_acceptances")
      .select("id, status")
      .eq("engagement_id", target.engagementId)
      .maybeSingle();
    if (!acceptance) {
      failed.push({ name: expertName, reason: "수락서를 만들지 못했습니다." });
      continue;
    }
    if (acceptance.status === "confirmed") {
      skipped += 1;
      continue;
    }

    attached += await copyProjectAttachmentsToAcceptance({
      tenantId: auth.session.tenantId,
      projectId: input.projectId,
      acceptanceId: acceptance.id,
      expertId: target.expertId,
      uploadedBy: auth.session.userId,
    });

    // 이미 서명한 건은 상태를 되돌리지 않는다 — 서명 사실이 사라지면 안 된다
    if (acceptance.status !== "signed") {
      const { error } = await supabase
        .from("engagement_acceptances")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", acceptance.id);
      if (error) {
        failed.push({ name: expertName, reason: "송신 처리에 실패했습니다." });
        continue;
      }
    }

    const letterPath = `/expert/engagements/${target.engagementId}/acceptance`;

    await notifyExpert({
      expertId: target.expertId,
      category: "engagement_request",
      title: "수락서가 도착했습니다 — 확인 및 승인(서명)이 필요합니다",
      body: project.name,
      link: letterPath,
      tenantId: auth.session.tenantId,
    });

    if (input.channel === "sms" || input.channel === "both") {
      await sendEngagementSms({
        tenantId: auth.session.tenantId,
        senderUserId: auth.session.userId,
        expertId: target.expertId,
        body: [
          `[${tenantName}] 수락서 도착`,
          project.name,
          input.memo?.trim() || null,
          "※ 수락서는 캐스트로그에서 확인·승인하셔야 합니다.",
          portalUrl(letterPath),
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    if (input.channel === "email" || input.channel === "both") {
      await sendEngagementEmail({
        tenantId: auth.session.tenantId,
        senderUserId: auth.session.userId,
        expertId: target.expertId,
        subject: `[수락서] ${project.name} — 확인 및 승인(서명) 요청`,
        body: [
          `${tenantName}에서 수락서를 보내드립니다.`,
          "",
          "수락서는 캐스트로그 화면에서 확인하실 수 있습니다. 이 메일은 수락서가",
          "도착했다는 안내이며, 수락서 자체는 첨부되지 않습니다.",
          "",
          `확인·승인: ${portalUrl(letterPath)}`,
          input.memo?.trim() ? `\n${input.memo.trim()}` : "",
          "",
          "※ 포털 로그인 후 확인하실 수 있습니다.",
        ].join("\n"),
      });
    }

    sent += 1;
  }

  if (sent === 0 && skipped === 0) {
    return {
      ok: false,
      error: `한 건도 송신되지 않았습니다. (${failed[0]?.reason ?? "원인 미상"})`,
    };
  }

  await supabase
    .from("projects")
    .update({
      engagement_stage: "letters_sent",
      acceptance_channel: input.channel,
      acceptance_sent_at: new Date().toISOString(),
    })
    .eq("id", input.projectId);

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "engagement_acceptance.send_batch",
    resource_type: "project",
    resource_id: input.projectId,
    after_data: {
      sent,
      skipped,
      attached,
      failed: failed.length,
      channel: input.channel,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, sent, skipped, attached, failed };
}
