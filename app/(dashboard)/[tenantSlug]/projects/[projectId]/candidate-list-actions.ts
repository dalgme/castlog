"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/supabase/errors";
import { practiceFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";
import { requireProjectTeam, requireTenantStaff } from "@/lib/projects/team";
import { MIN_MEMOS_PER_CANDIDATE, buildCandidateDraft } from "@/lib/integrations/candidate-lists";
import { movePrePlanStage } from "@/lib/integrations/pre-plan-stage";

/**
 * 섭외 후보 리스트 · 내부 검토 액션 (기획 승인 2026-11-07 — 2단계, 01·04·07번).
 *  - 내부 검토 요청: 지금 후보를 스냅샷으로 굳혀 리스트를 만들고 검토자(이사·대표)에게 알린다.
 *    자격메모 3개 미만 후보가 있으면 규칙 거부.
 *  - 검토 의견 / 검토 완료 / 내부 검토 마감 / 다시 작성(대체).
 * 모든 송신은 화면에서 미리보기를 거친 뒤 호출된다(04번).
 */

type Result = { ok: true } | { ok: false; error: string };
const NOT_READY = "리스트 작성 기능이 아직 열리지 않았습니다 (상태 미충족 — 데이터베이스 마이그레이션 0013 적용 전). 관리자에게 적용을 요청해 주세요.";
const SYSTEM_FAIL = "저장하지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";

function revalidate() {
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  revalidatePath("/[tenantSlug]/my-work", "page");
}

/** 쪽지 알림 — 표가 없거나 실패해도 본 작업을 막지 않는다 */
async function sendNoteQuietly(params: {
  tenantId: string;
  senderId: string;
  recipientIds: string[];
  projectId: string;
  body: string;
  practice: boolean;
}) {
  const recipients = Array.from(new Set(params.recipientIds)).filter((id) => id !== params.senderId);
  if (recipients.length === 0) return;
  try {
    const admin = createAdminClient();
    await admin.from("staff_notes").insert(
      recipients.map((recipientId) => ({
        tenant_id: params.tenantId,
        sender_user_id: params.senderId,
        recipient_user_id: recipientId,
        topic_kind: "project",
        project_id: params.projectId,
        body: params.body,
        is_practice: params.practice,
      }))
    );
  } catch {
    /* 알림은 보조 수단 — 탭·내 업무에서 같은 요청이 보인다 */
  }
}

const requestSchema = z.object({
  reviewerIds: z.array(z.string().uuid()).min(1, "내부 검토자를 한 명 이상 고르세요.").max(20),
  note: z.string().trim().max(1000, "요청 메모는 1,000자 이내로 적어 주세요.").optional(),
});

export type RequestInternalReviewResult = { ok: true; listId: string } | { ok: false; error: string };

export async function requestInternalReview(
  projectId: string,
  input: z.infer<typeof requestSchema>
): Promise<RequestInternalReviewResult> {
  const gate = await requireProjectTeam(projectId, "exec:candidateList");
  if (!gate.ok) return gate;
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  const supabase = createClient();
  const draft = await buildCandidateDraft(supabase, projectId);
  if (draft.candidateCount === 0) {
    return { ok: false, error: "리스트에 올릴 후보가 없습니다 (상태 미충족). '섭외후보 등록' 탭에서 자리에 전문가를 먼저 배정하세요." };
  }
  if (draft.shortOnMemos.length > 0) {
    const names = draft.shortOnMemos.map((s) => `${s.expertName}(${s.count}/${MIN_MEMOS_PER_CANDIDATE})`).join(", ");
    return {
      ok: false,
      error: `후보마다 자격메모 ${MIN_MEMOS_PER_CANDIDATE}개 이상이 있어야 내부 검토를 요청할 수 있습니다 (규칙). 부족한 후보: ${names}. 각 후보 행의 자격메모 칸을 채워 주세요.`,
    };
  }

  // 검토자는 이사·대표 등급의 활성 구성원만
  const { data: reviewers } = await supabase
    .from("users")
    .select("id, name, grade, is_active")
    .in("id", parsed.data.reviewerIds);
  const valid = (reviewers ?? []).filter((u) => u.is_active && (u.grade === "director" || u.grade === "ceo"));
  if (valid.length !== parsed.data.reviewerIds.length) {
    return { ok: false, error: "내부 검토자는 이사·대표 등급의 활성 구성원이어야 합니다 (규칙). 목록을 새로고침한 뒤 다시 고르세요." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("candidate_lists")
    .select("id, status, revision")
    .eq("project_id", projectId)
    .order("revision", { ascending: false });
  if (existingError) {
    if (isMissingTableError(existingError)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(existingError.message, SYSTEM_FAIL) };
  }
  const live = (existing ?? []).find((l) => l.status !== "submitted" && l.status !== "superseded");
  if (live) {
    return { ok: false, error: "이미 진행 중인 리스트가 있습니다 (상태 미충족). 그 리스트를 '다시 작성'으로 대체한 뒤 새로 요청하세요." };
  }
  const revision = ((existing ?? [])[0]?.revision ?? 0) + 1;
  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
  const practice = practiceFromUser(gate.actor.user);
  const now = new Date().toISOString();

  const { data: created, error: createError } = await supabase
    .from("candidate_lists")
    .insert({
      tenant_id: gate.actor.tenantId,
      project_id: projectId,
      revision,
      status: "internal_requested",
      title: `${project?.name ?? "프로젝트"} 섭외 후보 리스트 v${revision}`,
      note: parsed.data.note?.trim() || null,
      created_by: gate.actor.userId,
      internal_requested_at: now,
      is_practice: practice,
    })
    .select("id")
    .single();
  if (createError || !created) {
    return { ok: false, error: await explainActionError(createError?.message ?? "", SYSTEM_FAIL) };
  }

  const entryRows = draft.slots.flatMap((s) =>
    s.entries.map((e) => ({
      tenant_id: gate.actor.tenantId,
      list_id: created.id,
      slot_id: e.slotId,
      position_id: e.positionId,
      expert_id: e.expertId,
      rank: e.rank,
      code: e.code,
      session_label: e.sessionLabel,
      role_label: e.roleLabel,
      unit_fee_online: e.unitFeeOnline,
      unit_fee_offline: e.unitFeeOffline,
      total_fee_min: e.totalFeeMin,
      total_fee_max: e.totalFeeMax,
      memo_count: e.memos.length,
    }))
  );
  const { error: entriesError } = await supabase.from("candidate_list_entries").insert(entryRows);
  if (entriesError) {
    await supabase.from("candidate_lists").update({ status: "superseded" }).eq("id", created.id);
    return { ok: false, error: await explainActionError(entriesError.message, "리스트 행을 저장하지 못해 요청을 취소했습니다 (시스템 오류).") };
  }
  const { error: reviewsError } = await supabase.from("candidate_list_reviews").insert(
    valid.map((u) => ({
      tenant_id: gate.actor.tenantId,
      list_id: created.id,
      reviewer_user_id: u.id,
      requested_by: gate.actor.userId,
      requested_at: now,
    }))
  );
  if (reviewsError) {
    await supabase.from("candidate_lists").update({ status: "superseded" }).eq("id", created.id);
    return { ok: false, error: await explainActionError(reviewsError.message, "검토자 등록에 실패해 요청을 취소했습니다 (시스템 오류).") };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "candidate_list.internal_requested",
    resource_type: "candidate_list",
    resource_id: created.id,
    after_data: { project_id: projectId, revision, entries: entryRows.length, reviewers: valid.map((u) => u.id) },
  });
  // 프로젝트 섭외 단계 → 내부 검토 중 (4단계 단계값, 품의 전 구간에서만)
  await movePrePlanStage(supabase, projectId, "list_review");
  await sendNoteQuietly({
    tenantId: gate.actor.tenantId,
    senderId: gate.actor.userId,
    recipientIds: valid.map((u) => u.id),
    projectId,
    practice,
    body: `[내부 검토 요청] ${project?.name ?? "프로젝트"} 섭외 후보 리스트 v${revision}의 내부 검토를 부탁드립니다. 프로젝트 > '리스트 작성' 탭에서 후보별 의견을 남기고 '검토 완료'를 눌러 주세요.${parsed.data.note?.trim() ? `\n요청 메모: ${parsed.data.note.trim()}` : ""}`,
  });
  revalidate();
  return { ok: true, listId: created.id };
}

const commentSchema = z.object({
  listId: z.string().uuid(),
  entryId: z.string().uuid().nullable(),
  body: z.string().trim().min(1, "의견을 입력하세요.").max(1000, "의견은 1,000자 이내로 적어 주세요."),
});

export async function addListReviewComment(input: z.infer<typeof commentSchema>): Promise<Result> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const supabase = createClient();
  const { error } = await supabase.from("candidate_list_review_comments").insert({
    tenant_id: gate.actor.tenantId,
    list_id: parsed.data.listId,
    entry_id: parsed.data.entryId,
    author_user_id: gate.actor.userId,
    body: parsed.data.body,
  });
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, SYSTEM_FAIL) };
  }
  revalidate();
  return { ok: true };
}

/** 검토자 본인의 검토 완료 — 전원 완료되면 리스트가 '내부 검토 완료'가 된다 */
export async function completeMyReview(listId: string): Promise<Result> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(listId).success) return { ok: false, error: "리스트를 확인하세요." };
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("candidate_list_reviews")
    .update({ status: "done", done_at: new Date().toISOString() })
    .eq("list_id", listId)
    .eq("reviewer_user_id", gate.actor.userId)
    .eq("status", "requested")
    .select("id");
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, SYSTEM_FAIL) };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "내게 요청된 검토가 없거나 이미 완료했습니다 (상태 미충족)." };
  }
  await finishListIfAllDone(listId, gate.actor);
  revalidate();
  return { ok: true };
}

async function finishListIfAllDone(listId: string, actor: { userId: string; tenantId: string; role: string; user: { id: string } }) {
  const supabase = createClient();
  const { data: remaining } = await supabase
    .from("candidate_list_reviews")
    .select("id")
    .eq("list_id", listId)
    .eq("status", "requested");
  if ((remaining ?? []).length > 0) return;
  const { data: list } = await supabase
    .from("candidate_lists")
    .update({ status: "internal_done", internal_done_at: new Date().toISOString() })
    .eq("id", listId)
    .eq("status", "internal_requested")
    .select("id, project_id, created_by, title")
    .maybeSingle();
  if (!list) return;
  await supabase.from("audit_logs").insert({
    tenant_id: actor.tenantId,
    actor_auth_user_id: actor.userId,
    actor_role: actor.role,
    action: "candidate_list.internal_done",
    resource_type: "candidate_list",
    resource_id: listId,
    after_data: { project_id: list.project_id },
  });
  if (list.created_by) {
    await sendNoteQuietly({
      tenantId: actor.tenantId,
      senderId: actor.userId,
      recipientIds: [list.created_by],
      projectId: list.project_id,
      practice: false,
      body: `[내부 검토 완료] ${list.title} — 검토자 전원이 의견을 마쳤습니다. 프로젝트 > '리스트 작성' 탭에서 의견을 확인하세요.`,
    });
  }
}

/** 담당자가 검토를 마감한다 — 아직 응답하지 않은 검토자는 '마감됨'으로 남는다 */
export async function closeInternalReview(listId: string): Promise<Result> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  if (!z.string().uuid().safeParse(listId).success) return { ok: false, error: "리스트를 확인하세요." };
  const supabase = createClient();
  const { data: list, error } = await supabase.from("candidate_lists").select("id, project_id, status").eq("id", listId).maybeSingle();
  if (error && isMissingTableError(error)) return { ok: false, error: NOT_READY };
  if (!list) return { ok: false, error: "리스트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  const gate = await requireProjectTeam(list.project_id, "exec:candidateList");
  if (!gate.ok) return gate;
  if (list.status !== "internal_requested") return { ok: false, error: "내부 검토 중인 리스트만 마감할 수 있습니다 (상태 미충족)." };
  const { error: updateError } = await supabase
    .from("candidate_lists")
    .update({ status: "internal_done", internal_done_at: new Date().toISOString() })
    .eq("id", listId);
  if (updateError) return { ok: false, error: await explainActionError(updateError.message, SYSTEM_FAIL) };
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "candidate_list.internal_closed",
    resource_type: "candidate_list",
    resource_id: listId,
    after_data: { project_id: list.project_id },
  });
  revalidate();
  return { ok: true };
}

/** 다시 작성 — 진행 중 리스트를 대체 처리한다(이력은 남는다). 그 뒤 후보를 고쳐 새로 요청한다 */
export async function supersedeCandidateList(listId: string): Promise<Result> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  if (!z.string().uuid().safeParse(listId).success) return { ok: false, error: "리스트를 확인하세요." };
  const supabase = createClient();
  const { data: list, error } = await supabase.from("candidate_lists").select("id, project_id, status").eq("id", listId).maybeSingle();
  if (error && isMissingTableError(error)) return { ok: false, error: NOT_READY };
  if (!list) return { ok: false, error: "리스트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  const gate = await requireProjectTeam(list.project_id, "exec:candidateList");
  if (!gate.ok) return gate;
  if (list.status === "submitted" || list.status === "superseded") {
    return { ok: false, error: "이미 상신되었거나 대체된 리스트입니다 (상태 미충족)." };
  }
  const { error: updateError } = await supabase.from("candidate_lists").update({ status: "superseded" }).eq("id", listId);
  if (updateError) return { ok: false, error: await explainActionError(updateError.message, SYSTEM_FAIL) };
  await supabase.from("audit_logs").insert({
    tenant_id: gate.actor.tenantId,
    actor_auth_user_id: gate.actor.userId,
    actor_role: gate.actor.role,
    action: "candidate_list.superseded",
    resource_type: "candidate_list",
    resource_id: listId,
    after_data: { project_id: list.project_id, from_status: list.status },
  });
  // 리스트를 버렸으니 단계도 배정 중으로 (품의 전 구간에서만)
  await movePrePlanStage(supabase, list.project_id, "assigning");
  revalidate();
  return { ok: true };
}
