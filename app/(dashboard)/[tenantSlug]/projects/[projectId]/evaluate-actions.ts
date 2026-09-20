"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { requireExecGrade } from "@/lib/auth/exec-gate";
import { getTenantModules } from "@/lib/modules/server";

/**
 * 섭외 확정 탭의 전문가 평가 (기획 지시 2026-09-21).
 * 평점 5점 만점·1점 단위 + 평가의견 → '완료'를 누르면 그 전문가는 종료 처리된다.
 *
 * 저장 위치는 프로젝트 평가(expert_evaluations) 한 곳이다 — 전문가 검색의 평균 점수와
 * 종료 탭의 만족도가 같은 행을 읽는다. 10점 제약(score)에는 ×2로, 만족도(0~100)에는
 * ×20으로 환산해 함께 넣는다. 평가는 전문가 본인에게 보이지 않는다 (RLS, §4).
 */

const schema = z.object({
  projectId: z.string().uuid(),
  expertId: z.string().uuid(),
  engagementId: z.string().uuid(),
  slotId: z.string().uuid().nullable(),
  rating: z.number().int().min(1).max(5),
  opinion: z.string().trim().max(2000),
});

export type EvaluateInput = z.infer<typeof schema>;

export async function evaluateExpertAndComplete(
  input: EvaluateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요 (평점은 1~5점)." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  // 평가는 전문가 기록 축(expertRecord) — 만족도 입력과 같은 선
  const gate = await requireExecGrade("expertRecord");
  if (!gate.ok) return gate;
  const { projectId, expertId, engagementId, slotId, rating, opinion } = parsed.data;

  const supabase = createClient();
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, expert_id, project_id")
    .eq("id", engagementId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!engagement || engagement.expert_id !== expertId || engagement.project_id !== projectId) {
    return { ok: false, error: "섭외 건을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요." };
  }
  if (engagement.status !== "accepted") {
    return { ok: false, error: "계약이 성립한(승인된) 건만 평가·종료할 수 있습니다 (상태 미충족)." };
  }

  const score = rating * 2;
  const satisfaction = rating * 20;
  const memo = opinion || null;

  // (프로젝트·전문가·세션) 한 건 — 조회 후 갱신 (유니크 키가 coalesce 식 인덱스)
  const lookup = supabase
    .from("expert_evaluations")
    .select("id")
    .eq("project_id", projectId)
    .eq("expert_id", expertId);
  const { data: found } = await (slotId ? lookup.eq("slot_id", slotId) : lookup.is("slot_id", null)).maybeSingle();
  if (found) {
    const { error } = await supabase
      .from("expert_evaluations")
      .update({ score, satisfaction, memo, engagement_id: engagementId, evaluator_user_id: gate.userId })
      .eq("id", found.id);
    if (error) return { ok: false, error: "평가 저장에 실패했습니다 (시스템 오류). 다시 시도해 주세요." };
  } else {
    const { error } = await supabase.from("expert_evaluations").insert({
      tenant_id: gate.tenantId,
      project_id: projectId,
      expert_id: expertId,
      engagement_id: engagementId,
      slot_id: slotId,
      score,
      satisfaction,
      memo,
      evaluator_user_id: gate.userId,
    });
    if (error) return { ok: false, error: "평가 저장에 실패했습니다 (시스템 오류). 다시 시도해 주세요." };
  }

  // 완료 = 종료 처리 (기획 지시). 컬럼 미적용 DB면 평가만 남고 종료는 안내한다
  const { error: completeError } = await supabase
    .from("expert_engagements")
    .update({ completed_at: new Date().toISOString(), completed_by: gate.userId })
    .eq("id", engagementId)
    .eq("tenant_id", gate.tenantId)
    .is("completed_at", null);
  if (completeError && !isMissingColumnError(completeError)) {
    return { ok: false, error: "평가는 저장됐으나 종료 처리에 실패했습니다 (시스템 오류). '종료' 버튼으로 다시 처리해 주세요." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: "expert.evaluate_complete",
    resource_type: "expert_engagement",
    resource_id: engagementId,
    after_data: { project_id: projectId, expert_id: expertId, slot_id: slotId, rating, has_opinion: Boolean(memo) },
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/experts", "page");
  return completeError
    ? { ok: false, error: "평가는 저장됐습니다. 종료 표시는 서버 마이그레이션 적용 후 가능합니다 (시스템 설정)." }
    : { ok: true };
}
