import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingTableError } from "@/lib/supabase/errors";
import type { NoteProject, NoteRow, NoteUser } from "./types";

/**
 * 임직원 쪽지 서버 조회 (기획 지시 2026-11-07). RLS가 당사자(보낸이·받는이)만 돌려준다.
 * 표가 아직 없으면(마이그레이션 0011 미적용) ready=false — 화면은 '준비 중'으로 폴백 (§14-10).
 */

export type NotesSnapshot = {
  ready: boolean;
  notes: NoteRow[];
  users: NoteUser[];
  /** 주제로 고를 수 있는 개설 프로젝트(계획·진행중) + 쪽지가 가리키는 프로젝트(상태 무관) */
  projects: NoteProject[];
};

const NOTE_COLUMNS =
  "id, batch_id, sender_user_id, recipient_user_id, topic_kind, project_id, topic_label, body, read_at, created_at";

type NoteDbRow = {
  id: string;
  batch_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  topic_kind: string;
  project_id: string | null;
  topic_label: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
};

function toRow(r: NoteDbRow): NoteRow {
  return {
    id: r.id,
    batchId: r.batch_id,
    senderId: r.sender_user_id,
    recipientId: r.recipient_user_id,
    topicKind: r.topic_kind === "project" ? "project" : "other",
    projectId: r.project_id,
    topicLabel: r.topic_label,
    body: r.body,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/** 내 쪽지 전부(숨긴 것 제외, 최신 2,000건) + 구성원 + 프로젝트 */
export async function loadNotesSnapshot(myUserId: string): Promise<NotesSnapshot> {
  const supabase = createClient();
  const [notesRes, usersRes, projectsRes] = await Promise.all([
    supabase
      .from("staff_notes")
      .select(NOTE_COLUMNS)
      // 숨긴 쪽지는 내 쪽에서만 사라진다 — 보낸 사람은 sender_hidden_at, 받는 사람은 recipient_hidden_at
      .or(
        `and(sender_user_id.eq.${myUserId},sender_hidden_at.is.null),and(recipient_user_id.eq.${myUserId},recipient_hidden_at.is.null)`
      )
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("users")
      .select("id, name, department, is_active, positions(name)")
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, status, business_year")
      .neq("status", "cancelled")
      .order("business_year", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (notesRes.error && isMissingTableError(notesRes.error)) {
    return { ready: false, notes: [], users: [], projects: [] };
  }
  const notes = ((notesRes.data ?? []) as NoteDbRow[]).map(toRow);
  const users: NoteUser[] = (usersRes.data ?? []).map((u) => {
    const pos = u.positions as { name: string } | { name: string }[] | null;
    const positionName = Array.isArray(pos) ? pos[0]?.name ?? null : pos?.name ?? null;
    return { id: u.id, name: u.name, department: u.department, positionName, isActive: u.is_active };
  });
  const projects: NoteProject[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    businessYear: p.business_year,
  }));
  return { ready: true, notes, users, projects };
}

/** 사이드바 배지 — 안 읽은 받은 쪽지 수. 표가 없거나 실패하면 0 */
export async function getUnreadNotesCount(myUserId: string): Promise<number> {
  if (!hasSupabaseEnv()) return 0;
  const supabase = createClient();
  const { count, error } = await supabase
    .from("staff_notes")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", myUserId)
    .is("read_at", null)
    .is("recipient_hidden_at", null);
  if (error) return 0;
  return count ?? 0;
}
