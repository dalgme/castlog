"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  decidePlanFlow,
  type PlanFlow,
} from "@/lib/integrations/engagement-post-report";
import {
  createApprovalWithSteps,
  matchApprovalRule,
  type EngineLineStep,
} from "@/lib/approvals/engine";
import {
  buildPlanSnapshot,
  evaluatePlanGate,
  findUnreadySlots,
  type LivePlanView,
  type PlanSnapshot,
} from "@/lib/integrations/engagement-plans";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import { buildLineWithFixedTail } from "@/lib/approvals/manual-line";
import {
  buildGradeRelayLine,
  isPlanRelayEnabled,
} from "@/lib/approvals/relay";

/**
 * 직접 지정 결재라인 표기 — 결재자·감사로그 열람자가 규정 라인과 구분할 수
 * 있어야 한다 (리뷰 P3-10). appliedRuleId=null만으로는 화면에서 안 보인다.
 */
const MANUAL_LINE_NOTE = "\n\n※ 결재라인 직접 지정 (전결규정 미적용)";

export type PlanActionResult =
  | {
      ok: true;
      approvalId?: string | null;
      /** 38번: 사후보고로 즉시 확정됐으면 'post_report' — 호출자가 단계를 바로 연다 */
      flow?: "pre_approval" | "post_report";
    }
  | { ok: false; error: string };


type PlanSession = {
  ok: true;
  userId: string;
  tenantId: string;
  role: string;
  /** 사후보고 특례 문턱 판정용 (38번) */
  grade: string | null;
} | { ok: false; error: string };

/** 사후보고 문서임을 본문에도 남긴다 — 결재자·감사로그 열람자가 결재와 구분하도록 */
const POST_REPORT_NOTE =
  "\n\n※ 사후보고 — 섭외는 이미 확정·진행 중입니다. 확인 또는 피드백만 남겨 주세요 (진행을 되돌리지 않습니다).";

/**
 * 계획과 결재 문서를 연결 (38번): 사후보고면 status='approved'로 즉시 확정.
 * 신규 컬럼(flow·feedback_note) 미적용 환경이면 그 컬럼 없이 재시도(§14-10).
 * 연결에 실패하면 방금 만든 결재 문서를 취소해 고아를 남기지 않는다 (리뷰 P2-1).
 */
async function finalizePlanRecord(
  supabase: ReturnType<typeof createClient>,
  planId: string,
  approvalId: string,
  userId: string,
  flow: PlanFlow["mode"]
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const base = {
    status: flow === "post_report" ? "approved" : "in_progress",
    approval_id: approvalId,
    submitted_by: userId,
    submitted_at: nowIso,
    approved_at: flow === "post_report" ? nowIso : null,
    last_rejection_note: null,
  };
  const extra = { flow, feedback_note: null };
  let { error } = await supabase
    .from("engagement_plans")
    .update({ ...base, ...extra })
    .eq("id", planId);
  if (isMissingColumnError(error)) {
    ({ error } = await supabase
      .from("engagement_plans")
      .update(base)
      .eq("id", planId));
  }
  if (!error) return null;
  await supabase
    .from("approvals")
    .update({ status: "canceled", completed_at: nowIso })
    .eq("id", approvalId);
  // 살아 있는 계획끼리 세션 겹침 — DB 트리거(app.guard_engagement_plan_slot_overlap)
  if (error.code === "23P01" || error.message.includes("engagement_plan_slot_overlap")) {
    return "선택한 세션 중 이미 결재 중이거나 승인된 계획에 담긴 세션이 있습니다 (규칙). 새로고침한 뒤 그 세션을 빼고 다시 상신해 주세요. 문서는 취소 처리했습니다.";
  }
  return "결재 연결에 실패했습니다 (시스템 오류). 문서는 취소 처리했으니 다시 시도해 주세요.";
}

/** 세션 라벨 — 오류 문구용 */
async function slotLabels(slotIds: string[]): Promise<string> {
  if (slotIds.length === 0) return "";
  const supabase = createClient();
  const { data } = await supabase
    .from("engagement_slots")
    .select("id, slot_date, session_name, role_type")
    .in("id", slotIds);
  return (data ?? [])
    .map((s) => `${s.slot_date} ${s.session_name ?? s.role_type}`)
    .join(", ");
}

/** 다음 리비전 번호 — 반려·대체된 계획도 번호를 썼으므로 프로젝트 최대값+1 */
async function nextRevision(projectId: string): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("engagement_plans")
    .select("revision")
    .eq("project_id", projectId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.revision ?? 0) + 1;
}

/**
 * 선택 세션 기준 사전 품의/사후보고 미리 판정 (38번, 리뷰 P1-1) — 대화상자가
 * 세션을 고를 때마다 호출해 버튼 라벨·문구를 실제 서버 판정과 맞춘다.
 */
export async function previewPlanFlow(
  projectId: string,
  slotIds: string[] = []
): Promise<PlanFlow> {
  const auth = await requirePlanSession();
  if (!auth.ok) return { mode: "pre_approval", reason: null };
  const snapshot = await buildPlanSnapshot(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );
  return decidePlanFlow({
    amount: snapshot.plannedAmount,
    requesterGrade: auth.grade,
  });
}

async function requirePlanSession(): Promise<PlanSession> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return {
      ok: false,
      error:
        "전자결재 모듈이 비활성 상태입니다. 이 테넌트는 계획 품의 없이 바로 섭외요청을 보냅니다.",
    };
  }
  if (!modules.operations) {
    return { ok: false, error: "프로젝트 모듈이 비활성 상태입니다." };
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
  if (!(await canExecTenant("planSubmit", user))) {
    return { ok: false, error: await deniedExec("planSubmit") };
  }
  return { ok: true, userId: user.id, tenantId, role, grade: gradeFromUser(user) };
}

type LineResult =
  | { ok: true; ruleId: string | null; steps: EngineLineStep[] }
  | { ok: false; error: string };

/**
 * 결재라인 결정 (기획 개정 2026-08-30 — 18·27·30번). 우선순위:
 * ① 직접 선택(상위 직급만) + 고정 임원 tail → ② 상급자 릴레이(켠 경우)
 * → ③ 고정 임원선(상무이사 → 대표) → ④ 전결규정('프로젝트' 유형)
 * → ⑤ 직급 에스컬레이션(1인 기업 자가결재 포함).
 * 임원 계정이 있는 회사에서는 ④가 사실상 쓰이지 않는다 — 30번 기획
 * (상무이사·대표 고정 필수)이 규정보다 우선한다.
 */
async function resolveLine(
  amount: number,
  requesterUserId: string,
  tenantId: string,
  manualApproverIds: string[]
): Promise<LineResult> {
  const ids = Array.from(new Set(manualApproverIds.filter(Boolean)));

  // 직접 선택 (기획 개정 2026-08-30 — 30번): 상신자의 **상위 직급**만 고를
  // 수 있고, 선택과 무관하게 **상무이사·대표는 라인 끝에 고정(필수)** 이다.
  if (ids.length > 0) {
    const line = await buildLineWithFixedTail(tenantId, requesterUserId, ids);
    if (!line.ok) return line;
    return { ok: true, ruleId: null, steps: line.steps };
  }

  // 상급자 릴레이 (27번): 전자결재 메뉴에서 켠 회사는 직급 단계로 돌린다.
  // 릴레이 라인은 늘 최상위 재직 직급(상무·대표 포함)까지 올라간다.
  if (await isPlanRelayEnabled()) {
    const relay = await buildGradeRelayLine(requesterUserId);
    if (relay) return { ok: true, ruleId: null, steps: relay.steps };
  }

  // 선택이 없으면 고정 임원(상무이사 → 대표)만으로 라인을 만든다 (30번 —
  // 임원 고정이 필수라, 계획 품의는 전결규정보다 이 기본선이 먼저다).
  const fixed = await buildLineWithFixedTail(tenantId, requesterUserId, []);
  if (fixed.ok) return { ok: true, ruleId: null, steps: fixed.steps };

  // 임원 계정이 없는 회사 — 기존 폴백 유지 (규정 → 직급 에스컬레이션).
  const matched = await matchApprovalRule("project", amount);
  if (matched) {
    if (matched.steps.some((s) => s.approverUserId === requesterUserId)) {
      return {
        ok: false,
        error: "상신자 본인이 결재자로 지정된 전결규정입니다. 전결규정을 확인하세요.",
      };
    }
    return { ok: true, ruleId: matched.ruleId, steps: matched.steps };
  }
  // 상신자가 대표이고 상위 결재자가 없는 1인 기업이면 대표 자가결재로
  // 진행한다 — 그렇지 않으면 섭외를 시작할 방법 자체가 없다.
  const escalation = await buildGradeEscalationLine(requesterUserId, amount);
  if (escalation) {
    return { ok: true, ruleId: null, steps: escalation.steps };
  }
  return {
    ok: false,
    error:
      "결재선을 만들 수 없습니다 — 상위 직급·임원 계정이 없습니다. 상위 직급 계정을 추가하거나 전결규정('프로젝트' 유형)을 등록하세요.",
  };
}


/**
 * 멘티 정보 동봉 (기획 확정 2026-08-30 — 34번): 컨설팅 세션의 멘티
 * (소속/직위/이름/아이템명/유형)를 품의 본문에 실어 결재자에게 전달한다.
 * 커버리지 세션에 멘티가 없으면 빈 문자열.
 */
async function buildMenteeSection(slotIds: string[]): Promise<string> {
  if (slotIds.length === 0) return "";
  const supabase = createClient();
  const [{ data: mentees, error }, { data: slots }] = await Promise.all([
    supabase
      .from("slot_mentees")
      .select("slot_id, org_name, position_title, name, item_name, mentee_type, sort_order")
      .in("slot_id", slotIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("engagement_slots")
      .select("id, session_name")
      .in("id", slotIds),
  ]);
  // 테이블 미적용(42P01)만 조용히 넘긴다 — 다른 오류는 흔적을 남긴다
  // (리뷰 P3-5). 어느 쪽이든 멘티 동봉 실패가 상신을 막지는 않는다.
  if (error) {
    if (error.code !== "42P01") {
      console.error("mentee section query failed:", error.message);
    }
    return "";
  }
  if (!mentees || mentees.length === 0) return "";
  const nameBySlot = new Map((slots ?? []).map((sl) => [sl.id, sl.session_name]));
  const lines: string[] = ["", "멘티 정보:"];
  for (const m of mentees) {
    lines.push(
      `· [${nameBySlot.get(m.slot_id) ?? "세션"}] ${[
        m.org_name,
        m.position_title,
        m.name,
      ]
        .filter(Boolean)
        .join("/")}${m.item_name ? ` — ${m.item_name}` : ""}${
        m.mentee_type ? ` (${m.mentee_type})` : ""
      }`
    );
  }
  return lines.join("\n");
}

/** 계획 명세(스냅샷) 저장 — JSON 블롭이 아니라 정규화 행으로 (CLAUDE.md 8) */
async function writePlanLines(
  planId: string,
  tenantId: string,
  snapshot: PlanSnapshot
): Promise<boolean> {
  const supabase = createClient();
  await supabase.from("engagement_plan_lines").delete().eq("plan_id", planId);
  if (snapshot.lines.length === 0) return true;

  const { error } = await supabase.from("engagement_plan_lines").insert(
    snapshot.lines.map((line) => ({
      tenant_id: tenantId,
      plan_id: planId,
      slot_id: line.slotId,
      slot_date: line.slotDate,
      starts_time: line.startsTime,
      ends_time: line.endsTime,
      role_type: line.roleType,
      role_description: line.roleDescription,
      required_count: line.requiredCount,
      fee_amount: line.feeAmount,
      location_name: line.locationName,
      subtotal: line.subtotal,
    }))
  );
  return !error;
}

/**
 * 상신 대상 세션의 완성 검사 (기획 확정 2026-08-30 — 22번).
 * 배정이 필요인원에 못 미치는 세션이 있으면 어느 세션이 왜 걸렸는지, 무엇을
 * 하면 되는지를 그대로 돌려준다. 빈 후보 TO는 막지 않는다 (E2E 검수 P2-4).
 */
async function assertSlotsReady(
  projectId: string,
  slotIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unready = await findUnreadySlots(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );
  if (unready.length === 0) return { ok: true };
  const detail = unready
    .map((s) => `${s.label} (배정 ${s.assignedCount}/${s.requiredCount}명)`)
    .join(", ");
  return {
    ok: false,
    error:
      `상신하려는 세션에 필요인원만큼 전문가가 배정되지 않았습니다 (규칙): ${detail}. ` +
      `후보 자리에 전문가를 배정하거나 필요인원을 조정한 뒤 다시 품의를 상신해 주세요. ` +
      `미완성 세션은 선택에서 빼고 완성된 세션만 먼저 상신할 수도 있습니다. (빈 후보 자리는 상신을 막지 않습니다)`,
  };
}

/**
 * 섭외계획 품의 상신 (최초 또는 반려 후 재상신).
 * 현재 섭외 테이블을 그대로 계획으로 고정하고 결재라인을 붙인다.
 * slotIds를 지정하면 그 세션들만 계획에 담는다 (부분 상신 — 22번). 빈 배열 = 전체.
 */
export async function submitEngagementPlan(
  projectId: string,
  note: string,
  manualApproverIds: string[] = [],
  slotIds: string[] = []
): Promise<PlanActionResult> {
  const auth = await requirePlanSession();
  if (!auth.ok) return auth;

  const snapshot = await buildPlanSnapshot(
    projectId,
    slotIds.length > 0 ? slotIds : undefined
  );
  if (snapshot.slotCount === 0) {
    return {
      ok: false,
      error: "섭외 테이블이 비어 있습니다. 타임테이블과 필요인원을 먼저 등록하세요.",
    };
  }

  const ready = await assertSlotsReady(projectId, slotIds);
  if (!ready.ok) return ready;

  // 다중 계획 (기획 지시 2026-09-05): 결재 중·승인된 계획이 있어도 그 계획에
  // 담기지 않은 세션은 별도 품의로 올릴 수 있다. 이미 살아 있는 계획에 담긴
  // 세션만 거른다 — 같은 세션이 두 결재에 오르면 어느 쪽이 진실인지 알 수 없다.
  const gate = await evaluatePlanGate(projectId, true);
  const targetSlotIds = snapshot.lines.map((l) => l.slotId);
  if (gate.required) {
    const busy = targetSlotIds.filter((id) => {
      const st = gate.slotStates[id];
      return st === "in_progress" || st === "approved" || st === "changed";
    });
    if (busy.length > 0) {
      return {
        ok: false,
        error:
          `이미 결재 중이거나 승인된 계획에 담긴 세션이 있습니다 (규칙): ${await slotLabels(busy)}. ` +
          `그 세션을 선택에서 빼고 상신해 주세요. 승인된 세션의 내용을 바꾸려면 섭외계획 패널에서 해당 계획의 변경 품의를 올립니다.`,
      };
    }
  }

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const line = await resolveLine(
    snapshot.plannedAmount,
    auth.userId,
    auth.tenantId,
    manualApproverIds
  );
  if (!line.ok) return line;

  // 반려된 계획(draft)이 이 세션들과 겹치면 그 행을 재사용한다(리비전 유지 —
  // 반려 후 재상신). 겹치는 draft가 여럿이면 첫 건만 쓰고 나머지는 대체 처리.
  const overlappingDrafts: LivePlanView[] = gate.required
    ? gate.plans.filter(
        (v) =>
          (v.state === "rejected" || v.state === "draft") &&
          (v.coveredSlotIds === null ||
            v.coveredSlotIds.some((id) => targetSlotIds.includes(id)))
      )
    : [];
  const reuse = overlappingDrafts[0] ?? null;
  for (const extra of overlappingDrafts.slice(1)) {
    await supabase
      .from("engagement_plans")
      .update({ status: "superseded" })
      .eq("id", extra.plan.id);
  }

  let planId = reuse?.plan.id ?? null;
  if (planId) {
    const { error } = await supabase
      .from("engagement_plans")
      .update({
        slot_count: snapshot.slotCount,
        position_count: snapshot.positionCount,
        planned_amount: snapshot.plannedAmount,
        plan_signature: snapshot.signature,
        note: note.trim() || null,
      })
      .eq("id", planId);
    if (error) return { ok: false, error: "계획 저장에 실패했습니다." };
  } else {
    const { data: created, error } = await supabase
      .from("engagement_plans")
      .insert({
        tenant_id: auth.tenantId,
        project_id: projectId,
        revision: await nextRevision(projectId),
        status: "draft",
        slot_count: snapshot.slotCount,
        position_count: snapshot.positionCount,
        planned_amount: snapshot.plannedAmount,
        plan_signature: snapshot.signature,
        note: note.trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "계획 생성에 실패했습니다." };
    planId = created.id;
  }

  if (!(await writePlanLines(planId, auth.tenantId, snapshot))) {
    return { ok: false, error: "계획 명세 저장에 실패했습니다." };
  }

  // 사전 품의 vs 사후보고 (38번) — 화면 버튼과 같은 판정 함수
  const flow = await decidePlanFlow({
    amount: snapshot.plannedAmount,
    requesterGrade: auth.grade,
  });
  const isReport = flow.mode === "post_report";

  // 멘티 정보 동봉 (34번) — 계획에 담긴 세션 기준
  const menteeSection = await buildMenteeSection(
    snapshot.lines.map((l) => l.slotId)
  );
  const approval = await createApprovalWithSteps({
    tenantId: auth.tenantId,
    requesterUserId: auth.userId,
    // 세션 묶음마다 문서가 따로 간다 — 제목에 담긴 세션 수를 적어 구분한다
    title: `${isReport ? "[섭외 사후보고]" : "[섭외계획]"} ${project.name} · 세션 ${snapshot.slotCount}건`,
    body:
      `섭외 인원 ${snapshot.positionCount}명 / 타임테이블 ${snapshot.slotCount}건\n` +
      `계획 섭외비 ${snapshot.plannedAmount.toLocaleString("ko-KR")}원\n\n` +
      (note.trim() || "") +
      menteeSection +
      (manualApproverIds.length > 0 ? MANUAL_LINE_NOTE : "") +
      (isReport ? POST_REPORT_NOTE : ""),
    approvalType: "project",
    amount: snapshot.plannedAmount,
    projectId,
    appliedRuleId: line.ruleId,
    steps: line.steps,
    approvalKind: isReport ? "report" : "decision",
  });
  if (!approval.ok) return approval;

  const linkError = await finalizePlanRecord(
    supabase,
    planId,
    approval.approvalId,
    auth.userId,
    flow.mode
  );
  if (linkError) {
    // 새로 만든 계획 행이 draft로 남으면 패널에 '임시' 카드로 떠돈다 — 지운다
    // (명세는 cascade). 재사용한 반려 draft는 그대로 둔다 (리뷰 M2)
    if (!reuse) {
      await supabase.from("engagement_plans").delete().eq("id", planId);
    }
    return { ok: false, error: linkError };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: isReport ? "engagement_plan.post_report" : "engagement_plan.submit",
    resource_type: "engagement_plan",
    resource_id: planId,
    after_data: {
      project_id: projectId,
      approval_id: approval.approvalId,
      planned_amount: snapshot.plannedAmount,
      position_count: snapshot.positionCount,
      flow: flow.mode,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, approvalId: approval.approvalId, flow: flow.mode };
}

/**
 * 계획 변경 품의 상신 — 승인된 계획이 있는 상태에서 섭외 테이블이 바뀐 경우.
 * 이전 계획은 유지한 채 새 리비전을 만들고, 승인되면 이전 계획이 superseded 된다.
 * 이미 확정된 섭외건은 취소하지 않는다 (취소는 별도 섭외 취소 절차).
 */
export async function submitEngagementPlanChange(
  projectId: string,
  reason: string,
  manualApproverIds: string[] = [],
  /**
   * 새 계획이 덮을 세션 (22번 — 보완 상신): 지정하면 그 세션들이 새 커버리지가
   * 된다(기존 + 추가 세션을 함께 넘긴다). 미지정 = 기존 계획의 커버리지 유지.
   */
  slotIds: string[] = [],
  /**
   * 변경할 승인 계획 (다중 계획, 2026-09-05). 미지정이면 승인 계획이 정확히
   * 1건일 때만 그 계획으로 간주한다 — 여럿이면 화면이 골라 넘겨야 한다.
   */
  planId?: string | null
): Promise<PlanActionResult> {
  const auth = await requirePlanSession();
  if (!auth.ok) return auth;

  if (!reason.trim()) {
    return { ok: false, error: "변경 사유를 입력하세요." };
  }

  const gate = await evaluatePlanGate(projectId, true);
  const approvedViews = gate.required
    ? gate.plans.filter((v) => v.state === "approved" || v.state === "changed")
    : [];
  const target =
    planId != null
      ? (approvedViews.find((v) => v.plan.id === planId) ?? null)
      : approvedViews.length === 1
        ? approvedViews[0]
        : null;
  if (!target) {
    return {
      ok: false,
      error:
        approvedViews.length === 0
          ? "승인된 계획이 없습니다. 최초 섭외계획 품의를 먼저 올려 주세요."
          : "변경할 계획을 지정하세요 (승인된 계획이 여러 건입니다).",
    };
  }
  const current = target.plan;

  const currentCovered = target.coveredSlotIds;
  const effectiveSlotIds =
    slotIds.length > 0 ? slotIds : (currentCovered ?? []);

  // 추가하려는 세션이 다른 살아 있는 계획에 담겨 있으면 안 된다
  if (gate.required) {
    const foreign = effectiveSlotIds.filter((id) => {
      if (currentCovered !== null && currentCovered.includes(id)) return false;
      const st = gate.slotStates[id];
      return st === "in_progress" || st === "approved" || st === "changed";
    });
    if (foreign.length > 0) {
      return {
        ok: false,
        error: `다른 계획(결재 중·승인)에 담긴 세션은 이 계획에 추가할 수 없습니다 (규칙): ${await slotLabels(foreign)}.`,
      };
    }
  }

  const snapshot = await buildPlanSnapshot(
    projectId,
    effectiveSlotIds.length > 0 ? effectiveSlotIds : undefined
  );
  if (snapshot.signature === current.planSignature) {
    return { ok: false, error: "승인된 계획과 달라진 내용이 없습니다." };
  }

  const ready = await assertSlotsReady(projectId, effectiveSlotIds);
  if (!ready.ok) return ready;

  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const line = await resolveLine(
    snapshot.plannedAmount,
    auth.userId,
    auth.tenantId,
    manualApproverIds
  );
  if (!line.ok) return line;

  // 같은 세션을 두 살아 있는 계획이 담을 수 없다(DB 트리거) — 변경 대상
  // 계획을 먼저 대체 상태로 비우고, 실패하면 되살린다
  const { error: parkError } = await supabase
    .from("engagement_plans")
    .update({ status: "superseded" })
    .eq("id", current.id);
  if (parkError) return { ok: false, error: "기존 계획 정리에 실패했습니다." };

  const revertParent = async () => {
    await supabase
      .from("engagement_plans")
      .update({ status: "approved" })
      .eq("id", current.id);
  };

  // 반려된 변경 계획(rejected)도 revision을 하나 썼다 — 프로젝트 최대값+1
  const newRevision = await nextRevision(projectId);

  const { data: created, error: createError } = await supabase
    .from("engagement_plans")
    .insert({
      tenant_id: auth.tenantId,
      project_id: projectId,
      revision: newRevision,
      status: "draft",
      parent_plan_id: current.id,
      slot_count: snapshot.slotCount,
      position_count: snapshot.positionCount,
      planned_amount: snapshot.plannedAmount,
      plan_signature: snapshot.signature,
      note: reason.trim(),
    })
    .select("id")
    .single();
  if (createError || !created) {
    await revertParent();
    return { ok: false, error: "변경 계획 생성에 실패했습니다." };
  }

  if (!(await writePlanLines(created.id, auth.tenantId, snapshot))) {
    await supabase.from("engagement_plans").delete().eq("id", created.id);
    await revertParent();
    return { ok: false, error: "계획 명세 저장에 실패했습니다." };
  }

  // 변경·보완도 같은 판정 (38번) — 추가 세션을 합산한 금액으로 상한을 다시 본다
  const flow = await decidePlanFlow({
    amount: snapshot.plannedAmount,
    requesterGrade: auth.grade,
  });
  const isReport = flow.mode === "post_report";

  const diff = snapshot.plannedAmount - current.plannedAmount;
  const approval = await createApprovalWithSteps({
    tenantId: auth.tenantId,
    requesterUserId: auth.userId,
    title: `${isReport ? "[섭외 사후보고 변경" : "[섭외계획 변경"} R${newRevision}] ${project.name} · 세션 ${snapshot.slotCount}건`,
    body:
      `인원 ${current.positionCount}명 → ${snapshot.positionCount}명\n` +
      `계획 섭외비 ${current.plannedAmount.toLocaleString("ko-KR")}원 → ` +
      `${snapshot.plannedAmount.toLocaleString("ko-KR")}원 ` +
      `(${diff >= 0 ? "+" : ""}${diff.toLocaleString("ko-KR")}원)\n\n` +
      `변경 사유: ${reason.trim()}` +
      (await buildMenteeSection(snapshot.lines.map((l) => l.slotId))) +
      (manualApproverIds.length > 0 ? MANUAL_LINE_NOTE : "") +
      (isReport ? POST_REPORT_NOTE : ""),
    approvalType: "project",
    amount: snapshot.plannedAmount,
    projectId,
    appliedRuleId: line.ruleId,
    steps: line.steps,
    approvalKind: isReport ? "report" : "decision",
  });
  if (!approval.ok) {
    await supabase.from("engagement_plans").delete().eq("id", created.id);
    await revertParent();
    return approval;
  }

  const linkError = await finalizePlanRecord(
    supabase,
    created.id,
    approval.approvalId,
    auth.userId,
    flow.mode
  );
  if (linkError) {
    // 연결 실패 — 새 계획을 지우고 부모를 되살린다 (리뷰 P3-4: 승인 계획이
    // 사라진 채 남으면 발송이 통째로 막힌다)
    await supabase.from("engagement_plans").delete().eq("id", created.id);
    await revertParent();
    return { ok: false, error: linkError };
  }
  // 사후보고면 이전 계획은 그대로 superseded(위에서 이미 비움) — 새 계획이 즉시 유효

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: isReport ? "engagement_plan.post_report" : "engagement_plan.change_submit",
    resource_type: "engagement_plan",
    resource_id: created.id,
    before_data: {
      revision: current.revision,
      planned_amount: current.plannedAmount,
      position_count: current.positionCount,
    },
    after_data: {
      revision: newRevision,
      planned_amount: snapshot.plannedAmount,
      position_count: snapshot.positionCount,
      approval_id: approval.approvalId,
      flow: flow.mode,
    },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, approvalId: approval.approvalId, flow: flow.mode };
}
