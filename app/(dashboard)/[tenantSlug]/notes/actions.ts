"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/supabase/errors";
import { practiceFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";
import { requireTenantStaff } from "@/lib/projects/team";

/**
 * 임직원 쪽지 액션 (기획 지시 2026-11-07) — 공통 기반, 모듈 게이트 없음.
 * 보내기(받는 사람 여럿 + 주제: 프로젝트/기타사항) · 읽음 · 숨김(삭제 대신).
 * RLS·트리거(0011)가 당사자·내용 불변을 다시 강제한다.
 */

export type NoteActionResult = { ok: true } | { ok: false; error: string };
export type SendNoteResult = { ok: true; sent: number } | { ok: false; error: string };

const NOT_READY = "쪽지 기능이 아직 열리지 않았습니다 (상태 미충족 — 데이터베이스 마이그레이션 0011 적용 전). 관리자에게 적용을 요청해 주세요.";
const SYSTEM_FAIL = "쪽지를 저장하지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";

export const sendNoteSchema = z
  .object({
    recipientIds: z.array(z.string().uuid()).min(1, "받는 사람을 한 명 이상 고르세요.").max(50, "받는 사람은 한 번에 50명까지입니다."),
    topicKind: z.enum(["project", "other"]),
    projectId: z.string().uuid().optional().or(z.literal("")),
    topicLabel: z.string().trim().max(60, "기타사항 제목은 60자 이내로 적어 주세요.").optional(),
    body: z.string().trim().min(1, "내용을 입력하세요.").max(4000, "쪽지는 4,000자 이내로 적어 주세요."),
  })
  .refine((v) => v.topicKind !== "project" || Boolean(v.projectId), {
    message: "프로젝트를 고르거나 '기타사항'을 선택하세요.",
    path: ["projectId"],
  });
export type SendNoteInput = z.infer<typeof sendNoteSchema>;

function revalidate() {
  revalidatePath("/[tenantSlug]/notes", "page");
  revalidatePath("/[tenantSlug]", "layout");
}

export async function sendNote(input: SendNoteInput): Promise<SendNoteResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const parsed = sendNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const data = parsed.data;
  const recipientIds = Array.from(new Set(data.recipientIds)).filter((id) => id !== gate.actor.userId);
  if (recipientIds.length === 0) {
    return { ok: false, error: "자기 자신에게는 쪽지를 보낼 수 없습니다. 다른 구성원을 고르세요." };
  }

  const supabase = createClient();
  // 받는 사람은 같은 회사의 활성 임직원이어야 한다 (RLS도 거부하지만 문구를 주기 위해 먼저 본다)
  const { data: recipients } = await supabase
    .from("users")
    .select("id, is_active")
    .in("id", recipientIds);
  const activeIds = new Set((recipients ?? []).filter((u) => u.is_active).map((u) => u.id));
  const missing = recipientIds.filter((id) => !activeIds.has(id));
  if (missing.length > 0) {
    return { ok: false, error: "받는 사람 중 자사 활성 구성원이 아닌 사람이 있습니다 (규칙 거부). 목록을 새로고침한 뒤 다시 고르세요." };
  }
  // 주제 프로젝트는 내 열람 범위 안이어야 한다
  let projectId: string | null = null;
  if (data.topicKind === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("id, status")
      .eq("id", data.projectId as string)
      .maybeSingle();
    if (!project) {
      return { ok: false, error: "선택한 프로젝트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨). 다른 프로젝트를 고르거나 '기타사항'으로 보내세요." };
    }
    projectId = project.id;
  }

  const batchId = randomUUID();
  const rows = recipientIds.map((recipientId) => ({
    tenant_id: gate.actor.tenantId,
    batch_id: batchId,
    sender_user_id: gate.actor.userId,
    recipient_user_id: recipientId,
    topic_kind: data.topicKind,
    project_id: projectId,
    topic_label: data.topicKind === "other" ? data.topicLabel?.trim() || null : null,
    body: data.body,
    is_practice: practiceFromUser(gate.actor.user),
  }));
  const { error } = await supabase.from("staff_notes").insert(rows);
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, SYSTEM_FAIL) };
  }
  revalidate();
  return { ok: true, sent: rows.length };
}

/** 상대와의 대화를 열면 그 사람이 내게 보낸 안 읽은 쪽지를 읽음 처리 */
export async function markNotesReadFrom(senderId: string): Promise<NoteActionResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(senderId).success) return { ok: false, error: "상대를 확인하세요." };
  const supabase = createClient();
  const { error } = await supabase
    .from("staff_notes")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", gate.actor.userId)
    .eq("sender_user_id", senderId)
    .is("read_at", null);
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "읽음 표시를 저장하지 못했습니다 (시스템 오류).") };
  }
  revalidate();
  return { ok: true };
}

/** 프로젝트별 보기에서 그 프로젝트(또는 기타사항)의 안 읽은 쪽지를 읽음 처리 */
export async function markNotesReadForTopic(projectId: string | null): Promise<NoteActionResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (projectId !== null && !z.string().uuid().safeParse(projectId).success) return { ok: false, error: "프로젝트를 확인하세요." };
  const supabase = createClient();
  let q = supabase
    .from("staff_notes")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", gate.actor.userId)
    .is("read_at", null);
  q = projectId ? q.eq("project_id", projectId) : q.eq("topic_kind", "other");
  const { error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "읽음 표시를 저장하지 못했습니다 (시스템 오류).") };
  }
  revalidate();
  return { ok: true };
}

/** 내 쪽에서만 숨긴다 — 상대에게는 남는다 (삭제 대신 숨김, §14-4) */
export async function hideNote(noteId: string): Promise<NoteActionResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(noteId).success) return { ok: false, error: "쪽지를 확인하세요." };
  const supabase = createClient();
  const { data: note } = await supabase
    .from("staff_notes")
    .select("id, sender_user_id, recipient_user_id")
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return { ok: false, error: "쪽지를 찾을 수 없습니다 (이미 숨겼거나 내 쪽지가 아님)." };
  const patch =
    note.sender_user_id === gate.actor.userId
      ? { sender_hidden_at: new Date().toISOString() }
      : { recipient_hidden_at: new Date().toISOString() };
  const { error } = await supabase.from("staff_notes").update(patch).eq("id", noteId);
  if (error) {
    return { ok: false, error: await explainActionError(error.message, "쪽지를 숨기지 못했습니다 (시스템 오류).") };
  }
  revalidate();
  return { ok: true };
}
