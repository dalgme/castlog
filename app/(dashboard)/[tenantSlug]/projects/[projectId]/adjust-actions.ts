"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase/errors";
import { requireProjectTeam } from "@/lib/projects/team";
import { composePlanDoc, loadAdjustTab } from "@/lib/integrations/adjust-tab";

import { submitEngagementPlan, type PlanSubmitResult } from "./position-assign-actions";

/**
 * 섭외 품의서 자동 작성 및 송신 — 섭외후보 조정 탭 (기획 승인 2026-11-07 — 4단계, 03·10번).
 *
 * 화면 미리보기와 같은 composePlanDoc으로 본문·첨부를 만들고, 기존 상신 액션(submitEngagementPlan)에
 * 본문을 넘긴다. 결재건이 만들어지면 첨부(approval_attachments)를 붙이고 계획 ↔ 리스트를 연결하며
 * 리스트는 '품의 상신됨'이 된다. 리스트가 없는 프로젝트(종전 방식)도 같은 길로 올린다.
 */

const schema = z.object({
  listId: z.string().uuid().nullable(),
  approverIds: z.array(z.string().uuid()).max(20),
  slotIds: z.array(z.string().uuid()).max(200),
});

export async function submitCandidateListPlan(projectId: string, input: z.infer<typeof schema>): Promise<PlanSubmitResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const gate = await requireProjectTeam(projectId, "exec:candidateList");
  if (!gate.ok) return gate;

  const data = await loadAdjustTab(projectId);
  if (parsed.data.listId) {
    if (!data.list || data.list.id !== parsed.data.listId) {
      return {
        ok: false,
        error: "화면의 리스트와 현재 진행 중인 리스트가 다릅니다 (상태 미충족). 새로고침한 뒤 다시 미리보기를 열어 주세요.",
      };
    }
  }
  const doc = composePlanDoc(data, parsed.data.slotIds.length > 0 ? parsed.data.slotIds : null);

  // 종전 상신 경로 — 세션 준비 검사·결재선·사후보고 판정·단계 전환은 모두 그 안에서
  const result = await submitEngagementPlan(projectId, parsed.data.approverIds, parsed.data.slotIds, doc.note);
  if (!result.ok) return result;

  const supabase = createClient();
  if (result.approvalId) {
    if (doc.attachments.length > 0) {
      const { error } = await supabase.from("approval_attachments").insert(
        doc.attachments.map((a) => ({
          tenant_id: gate.actor.tenantId,
          approval_id: result.approvalId as string,
          kind: a.kind,
          ref_id: a.refId,
          title: a.title.slice(0, 200),
          body_text: a.bodyText,
          created_by: gate.actor.userId,
        }))
      );
      // 표가 없으면(0015 전) 본문 요약만으로 간다 — 첨부는 보조이고 본문에 요약이 있다
      if (error && !isMissingTableError(error)) {
        console.error("approval_attachments insert failed:", error.message);
      }
    }
    if (data.list) {
      const { error } = await supabase
        .from("engagement_plans")
        .update({ candidate_list_id: data.list.id })
        .eq("approval_id", result.approvalId);
      if (error && !isMissingColumnError(error)) {
        console.error("engagement_plans.candidate_list_id update failed:", error.message);
      }
    }
  }
  if (data.list) {
    await supabase.from("candidate_lists").update({ status: "submitted" }).eq("id", data.list.id);
    await supabase.from("audit_logs").insert({
      tenant_id: gate.actor.tenantId,
      actor_auth_user_id: gate.actor.userId,
      actor_role: gate.actor.role,
      action: "candidate_list.submitted",
      resource_type: "candidate_list",
      resource_id: data.list.id,
      after_data: {
        project_id: projectId,
        approval_id: result.approvalId,
        auto_approved: result.autoApproved,
        slot_ids: parsed.data.slotIds,
        attachments: doc.attachments.map((a) => a.kind),
      },
    });
  }
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/my-work", "page");
  return result;
}
