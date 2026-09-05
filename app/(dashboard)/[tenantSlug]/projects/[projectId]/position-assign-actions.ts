"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import type { ExecFeature } from "@/lib/auth/exec-permissions";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import {
  logEngagementEvent,
  staffActorLabel,
} from "@/lib/integrations/engagement-events";
import { isPracticeMode } from "@/lib/practice/server";
import {
  getProjectEngagementState,
  pickDispatchTargets,
  REDISPATCH_STAGES,
} from "@/lib/integrations/project-engagement";
import {
  getActivePlan,
  buildPlanSnapshot,
  getPlanCoveredSlotIds,
} from "@/lib/integrations/engagement-plans";
import { submitEngagementPlan as submitPlanRecord } from "./plan-actions";
import {
  createEngagementAcceptance,
  copyProjectAttachmentsToAcceptance,
} from "@/lib/integrations/acceptance";
import { notifyExpert } from "@/lib/experts/notifications";
import {
  buildEngagementBundleSms,
  sendEngagementSms,
} from "@/lib/integrations/engagement-sms";
import {
  sendEngagementEmail,
  portalUrl,
} from "@/lib/integrations/engagement-email";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";
import { formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { requestEngagementForPosition } from "./positions/[positionId]/position-actions";

export type PositionAssignResult = { ok: true } | { ok: false; error: string };

type Session = { userId: string; tenantId: string; role: string };

/**
 * 실행 게이트 (기획 확정 2026-08-23 — 레벨 차등화):
 *  - 배정·해제 = 세션 입력 축(레벨 5까지)
 *  - 품의 상신·섭외 진행·수락서 = 실행 축(레벨 4까지) — 호출부에서 기능 지정
 */
async function requireManager(
  feature: ExecFeature = "planInput"
): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  const gate = await requireExecGrade(feature);
  if (!gate.ok) return gate;
  return {
    ok: true,
    session: { userId: gate.userId, tenantId: gate.tenantId, role: gate.role },
  };
}


/**
 * 후보 배정 전 자사 관계 보장 (기획 확정 2026-08-23 — 미연결 전문가 후보 등록).
 * 링크가 없으면 자동 생성한다(relation_source='engaged' — 섭외 시작으로 형성,
 * §4 전면 공개). 해제(revoked)된 관계는 조용히 되살리지 않고 거부한다.
 */
async function ensureExpertLink(
  tenantId: string,
  expertId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 판정은 자사 링크 실상태 기준 — 세션 RLS에 기대지 않고 admin으로
  // tenant_id를 명시해 읽는다 (담당자 본인이 전문가이기도 한 경우의 오판 방지).
  const admin = createAdminClient();

  // 이용 중지 전문가는 기존 링크 유무와 무관하게 신규 배정을 거부한다 —
  // 링크가 이미 있으면 아래 조기 통과로 우회되던 구멍 (리뷰 3).
  // 조회 실패(컬럼 미적용 환경)는 통과 — 부재 폴백 (§14-10)
  {
    const { data: activeCheck, error: activeError } = await admin
      .from("experts")
      .select("is_active")
      .eq("id", expertId)
      .maybeSingle();
    if (!activeError && activeCheck && activeCheck.is_active === false) {
      return {
        ok: false,
        error:
          "플랫폼에서 이용이 중지된 전문가입니다 (규칙). 다른 후보를 선택해 주세요.",
      };
    }
  }

  const { data: links, error: readError } = await admin
    .from("expert_tenant_links")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("expert_id", expertId);
  if (readError) {
    return { ok: false, error: "관계 확인에 실패했습니다. 잠시 후 다시 시도하세요." };
  }
  const statuses = (links ?? []).map((l) => l.status);
  if (statuses.includes("active") || statuses.includes("pending")) {
    return { ok: true };
  }
  if (statuses.includes("revoked")) {
    return {
      ok: false,
      error: "해제된 관계의 전문가입니다. 전문가 상세에서 관계를 다시 연결한 뒤 후보로 올리세요.",
    };
  }
  // 미연결 — 관계 자동 생성. 연습/실모드가 어긋나는 전문가는 만들지 않는다
  // (연습 세션이 실제 관계를 남기거나, 실모드에 연습 시드가 붙는 것 방지).
  const { data: expert } = await admin
    .from("experts")
    .select("id, is_practice, is_active")
    .eq("id", expertId)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가를 찾을 수 없습니다." };
  // 이용 중지 전문가에게 새 관계를 만들지 않는다 (관리모드 중지 — 규칙 거부)
  if (!expert.is_active) {
    return {
      ok: false,
      error:
        "플랫폼에서 이용이 중지된 전문가입니다 (규칙). 다른 후보를 선택해 주세요.",
    };
  }
  const practice = await isPracticeMode();
  if (expert.is_practice !== practice) {
    return { ok: false, error: "현재 모드에서 다룰 수 없는 전문가입니다." };
  }
  const { error } = await admin.from("expert_tenant_links").insert({
    tenant_id: tenantId,
    expert_id: expertId,
    status: "active",
    relation_source: "engaged",
    // 연결일 표기용 — 일방 생성이므로 생성 시점을 수락 시점으로 본다(보유자료 전례)
    accepted_at: new Date().toISOString(),
    is_practice: expert.is_practice,
  });
  if (error) {
    if (error.code !== "23505") {
      return { ok: false, error: "관계 생성에 실패했습니다. 잠시 후 다시 시도하세요." };
    }
    // 경합으로 이미 생겼다면 실제 상태를 다시 확인 — revoked면 통과시키지 않는다
    const { data: existing } = await admin
      .from("expert_tenant_links")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("expert_id", expertId)
      .maybeSingle();
    if (!existing || (existing.status !== "active" && existing.status !== "pending")) {
      return {
        ok: false,
        error: "해제된 관계의 전문가입니다. 전문가 상세에서 관계를 다시 연결한 뒤 후보로 올리세요.",
      };
    }
  }
  return { ok: true };
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

  // 미연결 전문가는 관계를 자동 생성한다 (해제된 관계만 거부)
  const linked = await ensureExpertLink(auth.session.tenantId, input.expertId);
  if (!linked.ok) return linked;

  const { data: updatedRows, error } = await supabase
    .from("engagement_slot_positions")
    .update({
      status: "assigned",
      assigned_expert_id: input.expertId,
      assigned_at: new Date().toISOString(),
      assigned_by: auth.session.userId,
    })
    .eq("id", input.positionId)
    .in("status", ["open", "assigned"])
    .is("engagement_id", null)
    .select("id");
  if (error || !updatedRows || updatedRows.length === 0) {
    return { ok: false, error: "배정에 실패했습니다. 자리 상태가 바뀌었을 수 있습니다 — 새로고침 후 다시 시도하세요." };
  }

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

/**
 * 세션 후보 일괄 배정 (기획 확정 2026-08-23 — 탐색 팝업 다중 선택).
 * 클릭한 자리부터 시작해 이 세션의 미배정 자리(rank 순)에 차례로 배정한다.
 * 상한 = 미배정 자리 수. 이미 이 세션에 올라간 전문가는 건너뛴다.
 */
export async function assignExpertsToSlot(input: {
  positionId: string;
  expertIds: string[];
}): Promise<
  | { ok: true; assigned: number; skipped: string[] }
  | { ok: false; error: string }
> {
  const auth = await requireManager();
  if (!auth.ok) return auth;
  if (input.expertIds.length === 0) {
    return { ok: false, error: "전문가를 선택하세요." };
  }

  const supabase = createClient();
  const { data: clicked } = await supabase
    .from("engagement_slot_positions")
    .select("id, status, slot_id, engagement_id")
    .eq("id", input.positionId)
    .maybeSingle();
  if (!clicked) return { ok: false, error: "대상을 찾을 수 없습니다." };

  const { data: positions } = await supabase
    .from("engagement_slot_positions")
    .select("id, status, rank, expert_id, assigned_expert_id, engagement_id")
    .eq("slot_id", clicked.slot_id)
    .order("rank", { ascending: true });
  // 배치 대상 = 클릭한 자리 + 아직 아무도 배정되지 않은 자리.
  // 이미 다른 전문가가 배정된 자리는 절대 조용히 덮어쓰지 않는다 —
  // 교체는 그 자리를 직접 클릭했을 때만 허용한다.
  const openPositions = (positions ?? []).filter(
    (p) =>
      !p.engagement_id &&
      (p.id === input.positionId ||
        (p.status === "open" && !p.assigned_expert_id))
  );
  // 클릭한 자리를 맨 앞으로 — 사용자가 고른 자리부터 채운다
  openPositions.sort((a, b) =>
    a.id === input.positionId ? -1 : b.id === input.positionId ? 1 : 0
  );
  if (openPositions.length === 0) {
    return { ok: false, error: "이 세션에 배정할 수 있는 자리가 없습니다." };
  }
  if (input.expertIds.length > openPositions.length) {
    return {
      ok: false,
      error: `이 세션의 후보 자리는 ${openPositions.length}개입니다. 선택 인원을 줄여 주세요.`,
    };
  }

  const inSlot = new Set(
    (positions ?? [])
      .flatMap((p) => [p.expert_id, p.assigned_expert_id])
      .filter(Boolean) as string[]
  );

  // 건너뛴 이유를 이름으로 돌려준다 — UUID 나열은 사용자가 읽을 수 없어
  // 같은 선택을 반복하게 만든다 (검수 G). 세션 RLS는 미연결·해제 전문가의
  // 이름을 가리는데, 그게 바로 건너뛰는 대상이다 — 이름은 §4 전면 공개
  // 정보이므로 admin으로 읽는다 (리뷰 4).
  const nameAdmin = createAdminClient();
  const { data: expertRows } = await nameAdmin
    .from("experts")
    .select("id, name")
    .in("id", input.expertIds);
  const nameOf = new Map((expertRows ?? []).map((e) => [e.id, e.name]));

  let assigned = 0;
  const skipped: string[] = [];
  let cursor = 0;
  for (const expertId of input.expertIds) {
    const displayName = nameOf.get(expertId) ?? "(이름 확인 불가)";
    // 미연결이면 관계 자동 생성 (해제된 관계만 건너뜀)
    const linked = await ensureExpertLink(auth.session.tenantId, expertId);
    if (!linked.ok) {
      skipped.push(`${displayName} — ${linked.error}`);
      continue;
    }
    if (inSlot.has(expertId)) {
      skipped.push(`${displayName} — 이미 이 세션의 후보입니다`);
      continue;
    }
    const target = openPositions[cursor];
    if (!target) break;
    const { data: updatedRows, error } = await supabase
      .from("engagement_slot_positions")
      .update({
        status: "assigned",
        assigned_expert_id: expertId,
        assigned_at: new Date().toISOString(),
        assigned_by: auth.session.userId,
      })
      .eq("id", target.id)
      .in("status", ["open", "assigned"])
      .is("engagement_id", null)
      .select("id");
    if (error || !updatedRows || updatedRows.length === 0) {
      skipped.push(`${displayName} — 자리 상태가 바뀌어 배정하지 못했습니다`);
      continue;
    }
    inSlot.add(expertId);
    cursor += 1;
    assigned += 1;
    await supabase.from("audit_logs").insert({
      tenant_id: auth.session.tenantId,
      actor_auth_user_id: auth.session.userId,
      actor_role: auth.session.role,
      action: "engagement_position.assign",
      resource_type: "engagement_slot_position",
      resource_id: target.id,
      after_data: { expert_id: expertId, batch: true },
    });
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, assigned, skipped };
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
    .select("id, status, code, assigned_expert_id")
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
  if (error) {
    return {
      ok: false,
      error: "해제에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
    };
  }

  // 누가 이 후보를 뺐는지는 물을 수 있어야 한다 (검수 B8 — 무기록이었다)
  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: "position.unassign",
    resource_type: "engagement_slot_position",
    resource_id: positionId,
    before_data: {
      code: position.code,
      assigned_expert_id: position.assigned_expert_id,
    },
    after_data: { status: "open" },
  });

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
  projectId: string,
  // 결재라인 직접 지정 (기획 2026-08-30 — 18번). 비우면 규정→직급 체계
  approverIds: string[] = [],
  // 세션 부분 선택 (기획 2026-08-30 — 22번). 빈 배열 = 전체 세션
  slotIds: string[] = []
): Promise<PlanSubmitResult> {
  const auth = await requireManager("planSubmit");
  if (!auth.ok) return auth;

  const supabase = createClient();
  const state = await getProjectEngagementState(projectId);
  if (!state) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  if (state.stage !== "assigning") {
    return { ok: false, error: "이미 품의가 상신되었거나 다음 단계로 넘어갔습니다." };
  }
  // 세션을 골라 부분 상신하는 경우(22번)에는 전체 배정 완료를 요구하지 않는다 —
  // 선택 세션의 완성 검사는 계획 상신(plan-actions)에서 수행한다.
  if (slotIds.length === 0 && !state.fullyAssigned) {
    return {
      ok: false,
      error: `아직 배정되지 않은 자리가 ${state.open}개 있습니다. 전부 배정하거나, 완성된 세션만 선택해 상신하세요.`,
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
  const activePlan = await getActivePlan(projectId);
  const snapshot = await buildPlanSnapshot(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );

  // 예전 패널 경로로 이미 승인·결재중인 계획이 있는 프로젝트 — 새 결재를
  // 만들지 않고 단계만 그 결재건에 연결한다 (기존 데이터 구제).
  // 부분 상신 계획(22번)은 커버리지 세션 기준으로 지문을 대조한다.
  const rescueSignature =
    activePlan?.status === "approved"
      ? (
          await buildPlanSnapshot(
            projectId,
            (await getPlanCoveredSlotIds(activePlan.id)) ?? undefined
          )
        ).signature
      : null;
  if (
    activePlan?.status === "approved" &&
    activePlan.planSignature === rescueSignature
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

  const submitted = await submitPlanRecord(projectId, "", approverIds, slotIds);
  if (!submitted.ok) return submitted;
  const approvalId = submitted.approvalId ?? null;
  // 사후보고 모드(38번): 계획이 즉시 확정됐으므로 단계도 바로 연다 —
  // 보고 문서는 결재가 아니라 확인용이라 plan_review에 머물지 않는다
  const postReport = submitted.flow === "post_report";

  await supabase
    .from("projects")
    .update({
      engagement_stage: postReport ? "plan_approved" : "plan_review",
      engagement_plan_approval_id: approvalId,
    })
    .eq("id", projectId);

  await supabase.from("audit_logs").insert({
    tenant_id: auth.session.tenantId,
    actor_auth_user_id: auth.session.userId,
    actor_role: auth.session.role,
    action: postReport ? "engagement_plan.post_report" : "engagement_plan.submit",
    resource_type: "project",
    resource_id: projectId,
    after_data: {
      approval_id: approvalId,
      amount: snapshot.plannedAmount,
      flow: submitted.flow ?? "pre_approval",
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/approvals", "page");
  return { ok: true, approvalId, autoApproved: postReport };
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
  const auth = await requireManager("engagementRequest");
  if (!auth.ok) return auth;

  const state = await getProjectEngagementState(input.projectId);
  if (!state) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  // 최초 발송 뒤에도 보완(추가) 품의로 승인된 세션의 배정 자리는 다시 일괄
  // 발송할 수 있다 (감사 P2-1 — 이전에는 plan_approved에서만 열려 추가 세션은
  // 코드별 단건 요청만 가능했다). 수락서 송부 이후에는 닫는다.
  if (
    state.stage !== "plan_approved" &&
    !REDISPATCH_STAGES.includes(state.stage)
  ) {
    return {
      ok: false,
      error:
        state.stage === "assigning"
          ? "섭외 품의를 먼저 상신·승인받아야 합니다 (규칙)."
          : state.stage === "plan_review"
            ? "섭외 품의가 결재 진행 중입니다. 승인 후 발송할 수 있습니다."
            : "수락서 송부 이후에는 일괄 발송을 쓸 수 없습니다 (규칙). 추가 섭외는 코드넘버별 개별 요청으로 진행해 주세요.",
    };
  }

  const supabase = createClient();

  const { data: slots } = await supabase
    .from("engagement_slots")
    .select("id, required_count")
    .eq("project_id", input.projectId);
  const slotIds = (slots ?? []).map((s) => s.id);
  // 요청중·확정·거절 흔적(open + assigned_expert_id)까지 함께 읽는다 — 재발송
  // 모드에서는 이력이 있는 세션을 통째로 건너뛰어야 예비 후보에게 새지 않는다
  const redispatch = state.stage !== "plan_approved";
  const { data: positions } = slotIds.length
    ? await supabase
        .from("engagement_slot_positions")
        .select(
          "id, code, assigned_expert_id, status, slot_id, rank, position_no"
        )
        .in("slot_id", slotIds)
        .in("status", ["assigned", "requested", "filled", "open"])
    : { data: [] };

  // 후보 순위 모델 (개정 2026-08-22): 세션마다 순위 상위 '필요인원'명에게만
  // 요청을 보낸다. 후순위 후보는 예비로 남고, 거절 시 그 코드로 개별 요청한다.
  type DispatchTarget = {
    id: string;
    code: string;
    assigned_expert_id: string | null;
    status: string;
    slot_id: string;
    rank: number | null;
    position_no: number;
  };
  // 부분 상신 계획(기획 2026-08-30 — 22번)이면 승인 커버리지 밖 세션은 처음부터
  // 대상에서 뺀다 — 건별 게이트에 맡기면 묶음 생성·취소가 헛돌고(리뷰 P2-3·P2-5),
  // 매 발송이 '실패'투성이로 보인다. 뺀 세션은 규칙 사유로 명시한다 (§12-9).
  const failed: { code: string; reason: string }[] = [];
  const modulesForDispatch = await getTenantModules();
  let coveredSlotIds: string[] | null = null;
  if (modulesForDispatch.approvals) {
    const activePlan = await getActivePlan(input.projectId);
    if (activePlan?.status === "approved") {
      coveredSlotIds = await getPlanCoveredSlotIds(activePlan.id);
    }
  }

  const targets: DispatchTarget[] = [];
  for (const slot of slots ?? []) {
    const sorted = (positions ?? [])
      .filter((p) => p.slot_id === slot.id)
      .sort((a, b) => (a.rank ?? a.position_no) - (b.rank ?? b.position_no));
    const slotTargets = pickDispatchTargets(
      sorted,
      slot.required_count,
      redispatch
    );
    if (coveredSlotIds !== null && !coveredSlotIds.includes(slot.id)) {
      for (const p of slotTargets) {
        failed.push({
          code: p.code,
          reason:
            "승인된 섭외계획에 포함되지 않은 세션입니다 (규칙). 섭외계획 패널의 보완(추가) 품의로 승인받으면 이 버튼으로 다시 발송할 수 있습니다.",
        });
      }
      continue;
    }
    targets.push(...slotTargets);
  }
  if (targets.length === 0) {
    return {
      ok: false,
      error:
        failed.length > 0
          ? `발송 가능한 건이 없습니다. (${failed[0]?.reason ?? ""})`
          : redispatch
            ? "일괄 발송 대상이 없습니다 — 이미 요청이 나간 세션의 빈 자리(거절·만료)는 코드넘버별 개별 요청으로 채워 주세요 (규칙)."
            : "발송할 배정 건이 없습니다 — 세션마다 필요인원만큼 이미 요청·확정되었습니다.",
    };
  }

  let sent = 0;

  // 묶음 섭외 (기획 확정 2026-08-30 — 20번): 같은 전문가에게 가는 여러 자리는
  // 문자 1건 + 승인 URL 1개(/b)로 묶는다. 섭외 건 자체는 자리마다 그대로
  // 만들어진다(계약·수락서·자리 전환의 원본) — 발송만 전문가 단위로 합친다.
  const byExpert = new Map<string, DispatchTarget[]>();
  for (const position of targets) {
    const key = position.assigned_expert_id!;
    const group = byExpert.get(key);
    if (group) group.push(position);
    else byExpert.set(key, [position]);
  }

  const admin = createAdminClient();
  const isPractice = await isPracticeMode();
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", auth.session.tenantId)
    .maybeSingle();

  for (const [expertId, group] of Array.from(byExpert.entries())) {
    const [firstPosition] = group;
    if (group.length === 1 && firstPosition) {
      const position = firstPosition;
      const result = await requestEngagementForPosition({
        positionId: position.id,
        expertId,
        programName: input.programName,
        eventSummary: input.eventSummary,
        specialNotes: input.memo,
        responseDeadline: input.deadline,
        channel: input.channel,
      });
      if (result.ok) sent += 1;
      else failed.push({ code: position.code, reason: result.error });
      continue;
    }

    // ① 묶음 생성 — 회신 마감은 건별 토큰과 같은 값
    const bundleToken = generateLinkToken();
    const expiresAtIso = (input.deadline
      ? new Date(input.deadline)
      : new Date(Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
    ).toISOString();
    const { data: bundle, error: bundleError } = await supabase
      .from("engagement_bundles")
      .insert({
        tenant_id: auth.session.tenantId,
        project_id: input.projectId,
        expert_id: expertId,
        token_hash: hashLinkToken(bundleToken),
        token_expires_at: expiresAtIso,
        is_practice: isPractice,
        created_by: auth.session.userId,
      })
      .select("id")
      .single();
    if (bundleError || !bundle) {
      for (const position of group) {
        failed.push({
          code: position.code,
          reason: "묶음 생성에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
        });
      }
      continue;
    }

    // ② 건별 섭외 생성 — 발송만 억제 (감사로그·이력은 건별로 남는다).
    // sent는 아직 올리지 않는다 — 묶음 연결·발송까지 끝나야 '나간' 것이다
    // (리뷰 P2-3: 연결 실패 시 같은 자리가 sent와 failed에 동시 집계되던 결함)
    const createdIds: string[] = [];
    const createdPositions: DispatchTarget[] = [];
    for (const position of group) {
      const result = await requestEngagementForPosition({
        positionId: position.id,
        expertId,
        programName: input.programName,
        eventSummary: input.eventSummary,
        specialNotes: input.memo,
        responseDeadline: input.deadline,
        channel: input.channel,
        suppressSend: true,
      });
      if (result.ok) {
        createdIds.push(result.engagementId);
        createdPositions.push(position);
      } else {
        failed.push({ code: position.code, reason: result.error });
      }
    }
    if (createdIds.length === 0) {
      // 묶음에 담긴 건이 하나도 없다 — 빈 링크가 나가면 안 된다
      await admin
        .from("engagement_bundles")
        .update({ status: "canceled" })
        .eq("id", bundle.id)
        .eq("status", "requested");
      continue;
    }

    // ③ 건 → 묶음 연결 (service_role — 컬럼 미적용 DB에서도 발송 자체는 산다)
    let bundleLinked = true;
    try {
      const { error: linkError } = await admin
        .from("expert_engagements")
        .update({ bundle_id: bundle.id })
        .in("id", createdIds);
      if (linkError) bundleLinked = false;
    } catch {
      bundleLinked = false;
    }

    // ④ 전문가에게 1건만 발송 — 연결 실패 시 묶음 링크는 빈 화면이 되므로
    //    첫 건의 단건 안내로 대신하지 않고 실패로 알린다 (건은 이미 생성됨)
    const { data: itemRows } = await admin
      .from("expert_engagements")
      .select("id, session_name, fee_amount, starts_on, ends_on, starts_time, ends_time, location_name")
      .in("id", createdIds);
    const items = itemRows ?? [];
    const feeValues = items.map((i) => i.fee_amount).filter((v): v is number => v !== null);
    const totalFee = feeValues.length > 0 ? feeValues.reduce((a, b) => a + b, 0) : null;

    let bundleUrl: string;
    try {
      bundleUrl = buildPublicLink("engagementBundle", bundleToken);
    } catch {
      bundleUrl = `/b/${bundleToken}`;
    }

    if (!bundleLinked) {
      // 생성에 성공한 자리만 실패로 알린다 — 생성 단계에서 이미 실패한 자리를
      // 다시 넣으면 같은 코드가 두 번 찍힌다 (리뷰 P2-3)
      for (const position of createdPositions) {
        failed.push({
          code: position.code,
          reason:
            "섭외 건은 만들어졌으나 묶음 연결에 실패해 발송하지 못했습니다 (시스템 결함). 자리를 해제한 뒤 다시 발송해 주세요.",
        });
      }
      continue;
    }
    // 묶음 연결·발송까지 확정된 시점에 집계한다
    sent += createdIds.length;

    await notifyExpert({
      expertId,
      category: "engagement_request",
      title: `새로운 섭외 요청 ${createdIds.length}건이 도착했습니다`,
      body: [input.programName?.trim() || null, `${createdIds.length}개 세션`]
        .filter(Boolean)
        .join(" · "),
      link: "/expert/engagements",
      tenantId: auth.session.tenantId,
    });

    const useEmail = input.channel === "email" || input.channel === "both";
    const useSms = input.channel === "sms" || input.channel === "both";
    const deadlineLabel = new Date(expiresAtIso).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
    });

    if (useEmail) {
      const lines = items.map((i) => {
        const schedule = formatEventSchedule(
          i.starts_on,
          i.ends_on,
          i.starts_time,
          i.ends_time
        );
        return `· ${[i.session_name, schedule, i.location_name, i.fee_amount !== null ? `${i.fee_amount.toLocaleString("ko-KR")}원` : null].filter(Boolean).join(" / ")}`;
      });
      await sendEngagementEmail({
        tenantId: auth.session.tenantId,
        senderUserId: auth.session.userId,
        expertId,
        subject: `[섭외 요청 ${createdIds.length}건] ${input.programName?.trim() || "프로젝트 섭외"}`,
        body:
          `섭외를 요청드립니다. 아래 ${createdIds.length}건입니다.\n\n` +
          lines.join("\n") +
          // 단건 발송(/e)과 같은 정보량을 유지한다 — 수락 = 계약 성립인데
          // 행사 내용·특이사항을 못 보고 수락하게 해서는 안 된다 (리뷰 P2-2)
          (input.eventSummary?.trim()
            ? `\n\n· 행사 내용: ${input.eventSummary.trim()}`
            : "") +
          (input.memo?.trim() ? `\n· 특이사항: ${input.memo.trim()}` : "") +
          `\n\n· 회신 마감: ${deadlineLabel}까지` +
          `\n\n아래 링크에서 각 건을 확인하고 건별로 수락 또는 거절해 주세요.\n${bundleUrl}\n` +
          `문의는 이 메일에 회신하시거나 요청 기업 담당자에게 연락해 주세요.\n`,
      });
    }
    if (useSms) {
      await sendEngagementSms({
        tenantId: auth.session.tenantId,
        senderUserId: auth.session.userId,
        expertId,
        body: buildEngagementBundleSms({
          tenantName: tenantRow?.name ?? "기업",
          programName: input.programName?.trim() || null,
          itemCount: createdIds.length,
          totalFee,
          deadline: expiresAtIso,
          url: bundleUrl,
        }),
      });
    }
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
 * **송신 시점에 수락서를 파일로 첨부하지 않는다.** 문자·이메일은 '수락서가
 * 도착했으니 캐스트로그에서 확인하라'는 안내일 뿐이다.
 * (기획 변경 2026-08-30 — 19번: 전문가가 승인(서명)을 마친 뒤에는 기업
 *  담당자가 PDF로 내려받을 수 있다. 전문가 측은 계속 화면 열람만이다.)
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
  const auth = await requireManager("acceptanceSend");
  if (!auth.ok) return auth;
  // 라이트 모드 — 수락서 송신은 전문가 포털 서명 흐름의 시작이라 통째로 막는다.
  // 발송 없이 상태만 'sent'로 바꾸면 어디에도 도착하지 않은 문서를 기다리게 된다.
  if (await isExpertsLite()) {
    return {
      ok: false,
      error:
        "라이트 모드에서는 수락서를 송부하지 않습니다. 수동 '섭외 완료' 처리로 생성된 수락서는 화면에서 바로 확인·수정할 수 있습니다. 송신이 필요하면 설정 > 기업관리에서 라이트 모드를 끌 수 있습니다.",
    };
  }
  const senderName = await staffActorLabel(auth.session.userId);
  const sendIsPractice = await isPracticeMode();

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
    return { ok: false, error: "송부할 수락 건이 없습니다." };
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
        failed.push({ name: expertName, reason: "송부 처리에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." });
        continue;
      }

      // 섭외 이력 — 수락서 송부를 담당자 이름으로 기록 (송부 확정 후에만)
      await logEngagementEvent({
        tenantId: auth.session.tenantId,
        engagementId: target.engagementId,
        type: "acceptance_sent",
        actorKind: "staff",
        actorLabel: senderName,
        isPractice: sendIsPractice,
      });
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
          // 회사 명의 문자에 플랫폼 이름이 나오면 스미싱으로 오해된다 (§16)
          "※ 아래 링크(전문가 포털)에서 수락서를 확인·승인해 주세요.",
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
      error: `한 건도 송부되지 않았습니다. (${failed[0]?.reason ?? "원인 미상"})`,
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
