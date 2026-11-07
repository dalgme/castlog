import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { isPrePlanStage, projectStage, type ProjectStage } from "./project-stage";

/**
 * 품의 전 구간(배정 → 내부 검토 → 발주처 검토 → 후보 조정) 안에서 프로젝트 섭외 단계를 옮긴다
 * (기획 승인 2026-11-07 — 4단계). 품의가 이미 올라간 뒤(plan_review 이후)라면 건드리지 않는다 —
 * 다중 계획에서는 한 묶음이 결재 중인데 다른 묶음이 리스트 검토를 받을 수 있다.
 * 마이그레이션 0015 전에는 check 제약에 걸리므로 조용히 넘어간다(§14-10 부재 폴백).
 */
export async function movePrePlanStage(
  db: SupabaseClient<Database>,
  projectId: string,
  next: Extract<ProjectStage, "assigning" | "list_review" | "client_review" | "adjusting">
): Promise<void> {
  const { data: project } = await db.from("projects").select("engagement_stage").eq("id", projectId).maybeSingle();
  if (!project) return;
  const current = projectStage(project.engagement_stage);
  if (!isPrePlanStage(current) || current === next) return;
  await db.from("projects").update({ engagement_stage: next }).eq("id", projectId);
}
