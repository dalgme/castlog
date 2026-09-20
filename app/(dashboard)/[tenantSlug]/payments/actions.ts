"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { requirePaymentsAccess } from "@/lib/auth/admin-scopes";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";
import {
  createApprovalWithSteps,
  matchApprovalRule,
} from "@/lib/approvals/engine";
import { buildGradeEscalationLine } from "@/lib/approvals/grade-escalation";
import { formatKrw } from "@/lib/approvals/constants";
import {
  PAYMENT_TYPE_LABELS,
  calculateWithholding,
  isPaymentType,
} from "@/lib/payments/tax";
import {
  batchCreateSchema,
  type BatchCreateInput,
} from "@/lib/payments/schemas";

type Session = { userId: string; tenantId: string; role: string };

async function requirePaymentsSession(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  // 라이트 모드 — 지급·세무는 제공하지 않는다 (docs/decisions/experts-lite.md)
  if (await isExpertsLite()) {
    return {
      ok: false,
      error:
        "라이트 모드에서는 지급 기능을 사용하지 않습니다. 설정 > 기업관리에서 라이트 모드를 끄면 열립니다.",
    };
  }
  // 지급은 금액 축이다 — 직급이 아니라 finance 권한으로 가른다.
  // (대표·이사 기본 포함 + finance 위임자. DB의 app.can_manage_payments()와 동일)
  const access = await requirePaymentsAccess();
  if (!access.ok) return { ok: false, error: access.error };
  return {
    ok: true,
    session: {
      userId: access.userId,
      tenantId: access.tenantId,
      role: access.role,
    },
  };
}

/** 지급 품의 본문 자동 구성 — 전문가별 유형·총비용·원천징수·실지급 + 합계 */
function composeApprovalBody(
  projectName: string | null,
  lines: {
    expertName: string;
    paymentType: string;
    gross: number;
    withholding: number;
    net: number;
  }[],
  totals: { gross: number; withholding: number; net: number }
): string {
  const rows = lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.expertName} — ${PAYMENT_TYPE_LABELS[l.paymentType] ?? l.paymentType} | ` +
        `총비용 ${formatKrw(l.gross)} | 원천징수 ${formatKrw(l.withholding)} | 실지급 ${formatKrw(l.net)}`
    )
    .join("\n");

  return [
    projectName ? `프로젝트: ${projectName}` : "프로젝트: (미지정)",
    `지급 대상: ${lines.length}명 (일괄)`,
    "",
    rows,
    "",
    `합계 — 총비용 ${formatKrw(totals.gross)} / 원천징수 ${formatKrw(totals.withholding)} / 실지급 ${formatKrw(totals.net)}`,
    "",
    "* 원천징수액은 소득유형별 참고 계산이며, 지급 전 세무 확인이 필요합니다.",
  ].join("\n");
}

/** 배치의 지급 품의 상신 (내부 공용 — 생성 직후·재상신) */
async function submitBatchApprovalInternal(
  session: Session,
  batchId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();

  const { data: batch } = await supabase
    .from("expert_payment_batches")
    .select(
      "id, title, status, project_id, total_gross, total_withholding, total_net, projects (name)"
    )
    .eq("id", batchId)
    .maybeSingle();

  if (!batch || batch.status !== "pending") {
    return { ok: false, error: "상신할 수 없는 지급 건입니다." };
  }

  const { data: items } = await supabase
    .from("expert_payment_items")
    .select("payment_type, gross_amount, withholding_amount, net_amount, experts (name)")
    .eq("batch_id", batchId);

  if (!items || items.length === 0) {
    return { ok: false, error: "지급 라인이 없습니다." };
  }

  // 지급 품의 전결규정 매칭 — 총액 기준 (CLAUDE.md 7)
  // 전결규정이 있으면 그 결재선, 없으면 직급 체계로 위로 올린다.
  // 규정 미등록이 상신 자체를 막으면 초기 도입 기업은 지급을 시작할 수 없다.
  const matched = await matchApprovalRule("payment", batch.total_gross);
  const escalation = matched
    ? null
    : await buildGradeEscalationLine(session.userId, batch.total_gross);
  if (!matched && !escalation) {
    return {
      ok: false,
      error:
        "결재할 상위직급자가 없습니다. 전결규정(유형: 지급 품의)을 등록하거나 상위 직급 계정을 추가해 주세요.",
    };
  }
  const paymentLine = matched ? matched.steps : escalation!.steps;

  const body = composeApprovalBody(
    batch.projects?.name ?? null,
    items.map((item) => ({
      expertName: item.experts?.name ?? "-",
      paymentType: item.payment_type,
      gross: item.gross_amount,
      withholding: item.withholding_amount,
      net: item.net_amount,
    })),
    {
      gross: batch.total_gross,
      withholding: batch.total_withholding,
      net: batch.total_net,
    }
  );

  const created = await createApprovalWithSteps({
    tenantId: session.tenantId,
    requesterUserId: session.userId,
    title: `[일괄지급] ${batch.title}`,
    body,
    approvalType: "payment",
    amount: batch.total_gross,
    projectId: batch.project_id,
    appliedRuleId: matched?.ruleId ?? null,
    steps: paymentLine,
  });
  if (!created.ok) return created;

  const { error: linkError } = await supabase
    .from("expert_payment_batches")
    .update({
      status: "approval_in_progress",
      approval_id: created.approvalId,
      last_rejection_note: null,
    })
    .eq("id", batchId)
    .eq("status", "pending");

  if (linkError) {
    return { ok: false, error: "지급 건과 품의 연결에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "payment_batch.submit_approval",
    resource_type: "expert_payment_batch",
    resource_id: batchId,
    after_data: { approval_id: created.approvalId, total_gross: batch.total_gross },
  });

  return { ok: true };
}

export type CreateBatchResult =
  | { ok: true; batchId: string; submitted: boolean; warning?: string }
  | { ok: false; error: string };

/**
 * 일괄 지급 건 생성 (기획 확정 — 리스트 일괄 품의)
 * 전문가별 소득유형 스냅샷 + 원천징수 참고 계산으로 라인을 구성한다.
 * approvals 모듈 활성 시 지급 품의를 자동 상신한다 (규정 없으면 대기 상태 유지).
 */
export async function createPaymentBatch(
  input: BatchCreateInput
): Promise<CreateBatchResult> {
  const auth = await requirePaymentsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = batchCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  return createBatchCore(session, parsed.data, {});
}

/**
 * 지급 건 생성 공통부 — 비용·지급 화면(지급 권한자)과 프로젝트 '지급 품의' 탭(프로젝트 팀)이
 * 같은 검증·스냅샷·상신 절차를 쓴다. 게이트는 호출한 쪽이 이미 통과했다.
 * options.feeFallback: 섭외 건의 의뢰비용(fee_amount)이 비어 있을 때 대신 쓸 금액
 * (코드넘버 자리의 예정가 — 지급 품의 탭에서 넘긴다).
 */
async function createBatchCore(
  session: Session,
  data: BatchCreateInput,
  options: { feeFallback?: Map<string, number> }
): Promise<CreateBatchResult> {
  const projectId = data.projectId || null;
  const feeFallback = options.feeFallback ?? new Map<string, number>();
  const grossOf = (e: { id: string; fee_amount: number | null }) =>
    e.fee_amount ?? feeFallback.get(e.id) ?? null;

  const supabase = createClient();

  // 1) 대상 섭외 검증 — 수락(계약 성립) + 비용 존재 + 프로젝트 일치
  const { data: engagements } = await supabase
    .from("expert_engagements")
    .select("id, expert_id, project_id, status, fee_amount, experts (name)")
    .in("id", data.engagementIds);

  if (!engagements || engagements.length !== data.engagementIds.length) {
    return { ok: false, error: "선택한 섭외 건을 찾을 수 없습니다." };
  }
  for (const engagement of engagements) {
    if (engagement.status !== "accepted") {
      return { ok: false, error: "수락(계약 성립)된 섭외만 지급 대상입니다." };
    }
    if (grossOf(engagement) === null) {
      return {
        ok: false,
        error: `${engagement.experts?.name ?? "일부"} 전문가의 의뢰비용이 설정되지 않았습니다.`,
      };
    }
    if (engagement.project_id !== projectId) {
      return { ok: false, error: "같은 프로젝트의 섭외만 함께 묶을 수 있습니다." };
    }
  }

  // 1.5) 평가 게이트 (단계 27 — 대표 피드백 ①)
  //   프로젝트 귀속 지급은 참여 전문가 전원의 종료 평가가 완료돼야 상신 가능.
  //   projectId가 없는 지급(experts 단독 동작 — 프로젝트 비귀속)은 평가 게이트 없음.
  if (projectId) {
    const gateExpertIds = Array.from(
      new Set(engagements.map((e) => e.expert_id))
    );
    const { data: evaluations } = await supabase
      .from("expert_evaluations")
      .select("expert_id")
      .eq("project_id", projectId)
      .in("expert_id", gateExpertIds);
    const evaluated = new Set((evaluations ?? []).map((e) => e.expert_id));
    const unevaluated = engagements.filter((e) => !evaluated.has(e.expert_id));
    if (unevaluated.length > 0) {
      const names = Array.from(
        new Set(unevaluated.map((e) => e.experts?.name ?? "(이름 없음)"))
      ).join(", ");
      return {
        ok: false,
        error: `프로젝트 종료 평가가 완료되지 않은 전문가가 있습니다: ${names}. 프로젝트 화면에서 전문가 평가(점수)를 입력한 뒤 지급 품의를 진행하세요.`,
      };
    }
  }

  // 2) 중복 지급 방지 — 취소되지 않은 배치에 이미 포함된 섭외 제외
  const { data: existingItems } = await supabase
    .from("expert_payment_items")
    .select("engagement_id, expert_payment_batches!inner (status)")
    .in("engagement_id", data.engagementIds)
    .neq("expert_payment_batches.status", "canceled");

  if (existingItems && existingItems.length > 0) {
    return {
      ok: false,
      error: "이미 지급 건에 포함된 섭외가 있습니다. 목록을 새로고침하세요.",
    };
  }

  // 3) 소득유형 확인 — 전문가 본인이 포털에서 설정 (미설정 시 포함 불가)
  const expertIds = Array.from(new Set(engagements.map((e) => e.expert_id)));
  const { data: taxProfiles } = await supabase
    .from("expert_tax_profiles")
    .select("expert_id, payment_type")
    .in("expert_id", expertIds);

  const typeByExpert = new Map(
    (taxProfiles ?? [])
      .filter((p) => isPaymentType(p.payment_type))
      .map((p) => [p.expert_id, p.payment_type as string])
  );

  const missing = engagements.filter((e) => !typeByExpert.has(e.expert_id));
  if (missing.length > 0) {
    const names = missing
      .map((e) => e.experts?.name ?? "(이름 없음)")
      .join(", ");
    return {
      ok: false,
      error: `소득유형 미설정 전문가가 있습니다: ${names}. 전문가가 포털에서 사업소득/기타소득/사업자를 설정해야 합니다.`,
    };
  }

  // 4) 라인 계산 (스냅샷) + 합계
  const lines = engagements.map((engagement) => {
    const paymentType = typeByExpert.get(engagement.expert_id)!;
    if (!isPaymentType(paymentType)) {
      throw new Error("unreachable — isPaymentType filtered above");
    }
    const calc = calculateWithholding(paymentType, grossOf(engagement) ?? 0);
    return { engagement, paymentType, calc };
  });
  const totals = lines.reduce(
    (acc, l) => ({
      gross: acc.gross + l.calc.gross,
      withholding: acc.withholding + l.calc.withholding,
      net: acc.net + l.calc.net,
    }),
    { gross: 0, withholding: 0, net: 0 }
  );

  // 4.5) 부PM 실행 게이트 — 금액이 확정되는 단계다 (검수 A2: 배선 누락 수정).
  // 승인 1건은 실행 1회분이라 **모든 검증을 통과한 실행 직전**에 소진한다 —
  // 입력 오류로 승인만 태우면 부PM이 다시 받아와야 한다 (리뷰 6).
  if (projectId) {
    const deputyGate = await gateDeputyAction({
      projectId,
      actionType: "payment_batch.create",
      targetId: null,
    });
    if (!deputyGate.ok) return { ok: false, error: deputyGate.error };
  }

  // 5) 배치 + 라인 생성
  const { data: batch, error: batchError } = await supabase
    .from("expert_payment_batches")
    .insert({
      tenant_id: session.tenantId,
      project_id: projectId,
      title: data.title,
      total_gross: totals.gross,
      total_withholding: totals.withholding,
      total_net: totals.net,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { ok: false, error: "지급 건 생성에 실패했습니다." };
  }

  const { error: itemsError } = await supabase.from("expert_payment_items").insert(
    lines.map((l) => ({
      tenant_id: session.tenantId,
      batch_id: batch.id,
      engagement_id: l.engagement.id,
      expert_id: l.engagement.expert_id,
      payment_type: l.paymentType,
      gross_amount: l.calc.gross,
      withholding_amount: l.calc.withholding,
      net_amount: l.calc.net,
    }))
  );

  if (itemsError) {
    await supabase
      .from("expert_payment_batches")
      .update({ status: "canceled" })
      .eq("id", batch.id);
    return { ok: false, error: "지급 라인 생성에 실패했습니다. 다시 시도해 주세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "payment_batch.create",
    resource_type: "expert_payment_batch",
    resource_id: batch.id,
    after_data: {
      project_id: projectId,
      count: lines.length,
      total_gross: totals.gross,
    },
  });

  // 6) approvals 활성 시 지급 품의 자동 상신 — 규정 없으면 대기 상태로 두고 안내
  const modules = await getTenantModules();
  let submitted = false;
  let warning: string | undefined;
  if (modules.approvals) {
    const submitResult = await submitBatchApprovalInternal(session, batch.id);
    if (submitResult.ok) {
      submitted = true;
    } else {
      warning = submitResult.error;
    }
  }

  revalidatePath("/[tenantSlug]/payments", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true, batchId: batch.id, submitted, warning };
}

// ---------------------------------------------------------------------------
// 프로젝트 '지급 품의' 탭 — 세션 단위 지급 품의 (기획 지시 2026-09-21)
// ---------------------------------------------------------------------------

/**
 * 지급 품의 탭의 상신 주체 — 지급 권한자(대표·이사·finance 위임) 또는 그 프로젝트의
 * PL·PM·부PM. RLS(마이그레이션 0009)도 자기 프로젝트 팀에게만 지급 건 생성을 연다.
 * 부PM은 기존 실행 승인(gateDeputyAction)을 그대로 거친다.
 */
async function requireSessionPaymentSession(projectId: string): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  if (await isExpertsLite()) {
    return {
      ok: false,
      error: "라이트 모드에서는 지급 기능을 사용하지 않습니다. 설정 > 기업관리에서 라이트 모드를 끄면 열립니다.",
    };
  }
  const access = await requirePaymentsAccess();
  if (access.ok) {
    return { ok: true, session: { userId: access.userId, tenantId: access.tenantId, role: access.role } };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  const { data: mine } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  const teamRole = mine?.assignment_role ?? null;
  if (teamRole === "pl" || teamRole === "pl_pm" || teamRole === "pm" || teamRole === "deputy_pm") {
    return { ok: true, session: { userId: user.id, tenantId, role } };
  }
  return {
    ok: false,
    error: "지급 품의는 이 프로젝트의 PL·PM·부PM 또는 지급 권한자(대표·이사·지급 위임자)만 올릴 수 있습니다 (권한 규칙).",
  };
}

const sessionBatchSchema = z.object({
  projectId: z.string().uuid(),
  slotIds: z.array(z.string().uuid()).min(1, "지급 품의할 세션을 1개 이상 고르세요.").max(50),
});

/**
 * 고른 세션(1개 또는 여러 개)의 계약 성립 건을 한 지급 건으로 묶어 지급 품의를 올린다.
 * 조건: 세션의 모든 계약 성립 건이 종료(completed_at)·평가(expert_evaluations) 완료,
 * 아직 살아 있는 지급 건에 담기지 않음. 의뢰비용이 비어 있으면 코드넘버 자리의 예정가로 대신한다.
 */
export async function createSessionPaymentBatch(input: {
  projectId: string;
  slotIds: string[];
}): Promise<CreateBatchResult> {
  const parsed = sessionBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const { projectId, slotIds } = parsed.data;
  const auth = await requireSessionPaymentSession(projectId);
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const [{ data: project }, { data: slots }, { data: positions }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("engagement_slots")
      .select("id, slot_date, session_name, role_description")
      .eq("project_id", projectId)
      .in("id", slotIds),
    supabase
      .from("engagement_slot_positions")
      .select("slot_id, engagement_id, expected_fee")
      .in("slot_id", slotIds)
      .not("engagement_id", "is", null),
  ]);
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (!slots || slots.length !== slotIds.length) {
    return { ok: false, error: "고른 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요." };
  }
  const engagementIds = Array.from(
    new Set((positions ?? []).map((p) => p.engagement_id).filter((v): v is string => Boolean(v)))
  );
  if (engagementIds.length === 0) {
    return { ok: false, error: "고른 세션에 계약 성립(승인)된 전문가가 없습니다 (상태 미충족)." };
  }
  const engagementsResult = await supabase
    .from("expert_engagements")
    .select("id, status, completed_at, experts (name)")
    .in("id", engagementIds);
  if (isMissingColumnError(engagementsResult.error)) {
    return {
      ok: false,
      error: "종료 기능이 아직 이 서버에 준비되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션(0005) 적용을 요청해 주세요.",
    };
  }
  const accepted = (engagementsResult.data ?? []).filter((e) => e.status === "accepted");
  if (accepted.length === 0) {
    return { ok: false, error: "고른 세션에 계약 성립(승인)된 전문가가 없습니다 (상태 미충족)." };
  }
  const notCompleted = accepted.filter((e) => !e.completed_at);
  if (notCompleted.length > 0) {
    const names = Array.from(new Set(notCompleted.map((e) => e.experts?.name ?? "전문가"))).join(", ");
    return {
      ok: false,
      error: `아직 종료(평가·완료) 처리되지 않은 전문가가 있습니다: ${names}. 섭외 확정 탭에서 종료한 뒤 올려 주세요 (상태 미충족).`,
    };
  }

  // 예정가 폴백 — 의뢰비용(fee_amount)이 비어 있는 건
  const feeFallback = new Map<string, number>();
  for (const p of positions ?? []) {
    if (p.engagement_id && p.expected_fee !== null && p.expected_fee !== undefined) {
      feeFallback.set(p.engagement_id, p.expected_fee);
    }
  }

  const labels = slots
    .sort((a, b) => a.slot_date.localeCompare(b.slot_date))
    .map((s) => `${s.slot_date} ${s.session_name ?? s.role_description ?? "세션"}`);
  const title = `${project.name} — ${labels.length <= 2 ? labels.join(", ") : `${labels[0]} 외 ${labels.length - 1}개 세션`}`;

  return createBatchCore(
    session,
    { projectId, title: title.slice(0, 120), engagementIds: accepted.map((e) => e.id) },
    { feeFallback }
  );
}

/** 지급 품의 탭 — 반려돼 대기로 돌아온 지급 건 재상신 (프로젝트 팀·지급 권한자) */
export async function resubmitSessionBatch(input: {
  projectId: string;
  batchId: string;
}): Promise<BatchActionResult> {
  if (!z.string().uuid().safeParse(input.batchId).success || !z.string().uuid().safeParse(input.projectId).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }
  const auth = await requireSessionPaymentSession(input.projectId);
  if (!auth.ok) return auth;
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return { ok: false, error: "전자결재 모듈이 비활성 상태입니다. 비용·지급 화면에서 단순 확정을 사용하세요." };
  }
  const supabase = createClient();
  const { data: batch } = await supabase
    .from("expert_payment_batches")
    .select("id, project_id")
    .eq("id", input.batchId)
    .maybeSingle();
  if (!batch || batch.project_id !== input.projectId) {
    return { ok: false, error: "이 프로젝트의 지급 건이 아닙니다." };
  }
  const result = await submitBatchApprovalInternal(auth.session, input.batchId);
  if (!result.ok) return result;
  revalidatePath("/[tenantSlug]/payments", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

export type BatchActionResult = { ok: true } | { ok: false; error: string };

/** 대기 상태 배치의 지급 품의 (재)상신 */
export async function submitBatchApproval(
  batchId: string
): Promise<BatchActionResult> {
  const auth = await requirePaymentsSession();
  if (!auth.ok) return auth;

  const modules = await getTenantModules();
  if (!modules.approvals) {
    return { ok: false, error: "전자결재 모듈이 비활성 상태입니다. 단순 확정을 사용하세요." };
  }

  const result = await submitBatchApprovalInternal(auth.session, batchId);
  if (!result.ok) return result;

  revalidatePath("/[tenantSlug]/payments", "page");
  return { ok: true };
}

/** 결재 없이 단순 확정 — approvals 모듈 비활성 테넌트 전용 (단독 동작 경로) */
export async function confirmBatchSimple(
  batchId: string
): Promise<BatchActionResult> {
  const auth = await requirePaymentsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const modules = await getTenantModules();
  if (modules.approvals) {
    return {
      ok: false,
      error: "전자결재 모듈이 활성화된 테넌트는 지급 품의 결재를 거쳐야 합니다.",
    };
  }

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("expert_payment_batches")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "확정할 수 없는 지급 건입니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "payment_batch.simple_confirm",
    resource_type: "expert_payment_batch",
    resource_id: batchId,
  });

  revalidatePath("/[tenantSlug]/payments", "page");
  return { ok: true };
}

/** 지급 완료 기록 — 실제 이체는 시스템 밖 (확정 건만) */
export async function markBatchPaid(batchId: string): Promise<BatchActionResult> {
  const auth = await requirePaymentsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("expert_payment_batches")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "확정된 지급 건만 지급 완료 처리할 수 있습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "payment_batch.paid",
    resource_type: "expert_payment_batch",
    resource_id: batchId,
  });

  revalidatePath("/[tenantSlug]/payments", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 지급 건 취소 — 결재 전(pending)만 */
export async function cancelBatch(batchId: string): Promise<BatchActionResult> {
  const auth = await requirePaymentsSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("expert_payment_batches")
    .update({ status: "canceled" })
    .eq("id", batchId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "결재 전 상태의 지급 건만 취소할 수 있습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "payment_batch.cancel",
    resource_type: "expert_payment_batch",
    resource_id: batchId,
  });

  revalidatePath("/[tenantSlug]/payments", "page");
  return { ok: true };
}
