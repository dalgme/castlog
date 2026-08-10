"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  expertEvaluationSchema,
  type ExpertEvaluationInput,
} from "@/lib/experts/schemas";

type Session = { userId: string; tenantId: string; role: string };
export type EvaluationResult = { ok: true } | { ok: false; error: string };

/** 평가 권한 세션 — experts 모듈 + 책임담당자(관리자 이상) */
async function requireEvaluationSession(): Promise<
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
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "전문가 평가 권한이 없습니다 (책임담당자 이상)." };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

/**
 * 단계 27: 전문가 프로젝트 종료 평가 upsert (대표 피드백 ①).
 * (tenant, project, expert) 1건 — 재평가는 정정(upsert).
 * 평가는 전문가 비공개·테넌트 격리 (RLS). 지급 품의 게이트의 근거가 된다.
 */
export async function upsertExpertEvaluation(
  input: ExpertEvaluationInput
): Promise<EvaluationResult> {
  const auth = await requireEvaluationSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const parsed = expertEvaluationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const supabase = createClient();

  // 프로젝트가 자사 테넌트 소속인지 확인 (RLS SELECT 범위 내)
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  }

  // 전문가가 자사에 연결되어 있는지 확인 (교차 노출 방지 — 설계문서 4장)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("expert_id")
    .eq("expert_id", data.expertId)
    .eq("status", "active")
    .maybeSingle();
  if (!link) {
    return { ok: false, error: "자사에 연결된 전문가만 평가할 수 있습니다." };
  }

  const reason = data.reason?.trim() ? data.reason.trim() : null;

  const { error } = await supabase.from("expert_evaluations").upsert(
    {
      tenant_id: session.tenantId,
      project_id: data.projectId,
      expert_id: data.expertId,
      engagement_id: data.engagementId ?? null,
      score: data.score,
      reason,
      evaluator_user_id: session.userId,
    },
    { onConflict: "tenant_id,project_id,expert_id" }
  );

  if (error) {
    return { ok: false, error: "평가 저장에 실패했습니다. 다시 시도해 주세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "expert_evaluation.upsert",
    resource_type: "expert_evaluation",
    resource_id: data.expertId,
    after_data: { project_id: data.projectId, score: data.score },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
