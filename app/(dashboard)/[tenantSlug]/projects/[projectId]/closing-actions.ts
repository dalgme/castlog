"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";

export type ClosingActionResult = { ok: true } | { ok: false; error: string };

/**
 * 프로젝트 종료 (기획 지시 2026-09-21 — 지급 품의 탭).
 * 계약 성립 건이 담긴 모든 지급 건이 '지급 완료'여야 종료할 수 있다. 관리자 이상.
 * 종료는 status=completed·closed_at·engagement_stage=settled 로 표시한다 (§14-4 — 삭제 아님).
 */
export async function closeProjectAfterPayments(projectId: string): Promise<ClosingActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!z.string().uuid().safeParse(projectId).success) {
    return { ok: false, error: "프로젝트를 확인하세요." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "프로젝트 종료는 관리자 이상이 합니다 (권한 규칙)." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed") return { ok: false, error: "이미 종료된 프로젝트입니다." };
  if (project.status === "cancelled") return { ok: false, error: "취소된 프로젝트는 종료할 수 없습니다." };

  // 계약 성립 건 전부가 '지급 완료' 지급 건에 담겨 있어야 한다
  const { data: accepted } = await supabase
    .from("expert_engagements")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const acceptedIds = (accepted ?? []).map((e) => e.id);
  if (acceptedIds.length > 0) {
    const { data: items } = await supabase
      .from("expert_payment_items")
      .select("engagement_id, expert_payment_batches!inner (status)")
      .in("engagement_id", acceptedIds)
      .eq("expert_payment_batches.status", "paid");
    const paidIds = new Set((items ?? []).map((i) => i.engagement_id));
    const unpaid = acceptedIds.filter((id) => !paidIds.has(id));
    if (unpaid.length > 0) {
      return {
        ok: false,
        error: `아직 지급 완료되지 않은 계약 성립 건이 ${unpaid.length}건 있습니다 (상태 미충족). 지급 품의 탭에서 지급을 마친 뒤 종료해 주세요.`,
      };
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("projects")
    .update({ status: "completed", closed_at: now, engagement_stage: "settled" })
    .eq("id", projectId)
    .eq("tenant_id", tenantId);
  if (error) {
    return { ok: false, error: await explainActionError(error.message, "프로젝트를 종료하지 못했습니다.") };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "project.close_after_payments",
    resource_type: "project",
    resource_id: projectId,
    after_data: { accepted_count: acceptedIds.length },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/projects", "page");
  return { ok: true };
}
