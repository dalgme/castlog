"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireCeo } from "@/lib/auth/admin-scopes";
import { logAudit } from "@/lib/audit/log";
import { notifyExpert } from "@/lib/experts/notifications";
import { blockInPractice } from "@/lib/practice/server";
import { RRN_PROJECT_LIMIT } from "@/lib/integrations/rrn-access";

export type DecisionResult = { ok: true } | { ok: false; error: string };

/**
 * 초과 조회 요청 승인·반려 — **대표(ceo) 전용, 위임 불가** (CLAUDE.md §3-1).
 *
 * 승인은 조회 1회분의 권한이다. 실제 조회 시 consumed_at으로 소진되며(§5),
 * 승인 사실은 감사로그에, 조회 사실은 전문가 통지에 각각 남는다.
 */
async function decide(
  requestId: string,
  decision: "approved" | "denied",
  note: string
): Promise<DecisionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const practice = await blockInPractice("taxAccess");
  if (!practice.ok) return practice;

  const ceo = await requireCeo();
  if (!ceo.ok) return { ok: false, error: ceo.error };

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("tax_access_requests")
    .select("id, expert_id, project_id, over_limit_reason, status")
    .eq("id", requestId)
    .eq("tenant_id", ceo.tenantId)
    .eq("is_over_limit", true)
    .maybeSingle();
  if (!request) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (request.status !== "pending") {
    return { ok: false, error: "이미 처리된 요청입니다." };
  }

  const { error } = await admin
    .from("tax_access_requests")
    .update({
      status: decision,
      decided_by: ceo.userId,
      decided_at: new Date().toISOString(),
      decision_note: note.trim() || null,
      over_limit_approved_by: decision === "approved" ? ceo.userId : null,
      // 반려는 그 자리에서 닫는다 — 소진 처리해 승인 대기 목록에서 사라지게 한다.
      consumed_at: decision === "denied" ? new Date().toISOString() : null,
    })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, error: "처리하지 못했습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logAudit(supabase, user, {
    action:
      decision === "approved"
        ? "rrn.over_limit.approve"
        : "rrn.over_limit.deny",
    resourceType: "tax_access_requests",
    resourceId: requestId,
    afterData: { project_id: request.project_id, expert_id: request.expert_id },
  });

  // 승인 시점에 미리 알린다 — 조회가 실제로 일어날 때 한 번 더 통지된다.
  if (decision === "approved") {
    await notifyExpert({
      expertId: request.expert_id,
      category: "rrn_access",
      title: "주민등록번호 초과 조회가 승인되었습니다",
      body:
        `프로젝트당 ${RRN_PROJECT_LIMIT}회 한도를 넘는 조회가 대표 승인으로 1회 허용되었습니다. ` +
        `사유: ${request.over_limit_reason ?? "미기재"}`,
      link: "/expert/tax-access",
      tenantId: ceo.tenantId,
    });
  }

  revalidatePath(`/${ceo.tenantSlug}/admin/org/security`);
  return { ok: true };
}

export async function approveOverLimit(
  requestId: string,
  note: string
): Promise<DecisionResult> {
  return decide(requestId, "approved", note);
}

export async function denyOverLimit(
  requestId: string,
  note: string
): Promise<DecisionResult> {
  return decide(requestId, "denied", note);
}
