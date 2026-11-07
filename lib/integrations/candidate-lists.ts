import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/supabase/errors";
import { computeFeeTotal, formatFeeTotal } from "@/lib/sessions/fees";
import { describeSchedule } from "@/lib/sessions/schedule";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { SLOT_SCHEDULE_COLUMNS, loadSlotDates, scheduleFromRow } from "@/lib/integrations/slot-schedule";

type Db = SupabaseClient<Database>;

import {
  MIN_MEMOS_PER_CANDIDATE,
  type CandidateDraft,
  type CandidateDraftEntry,
  type CandidateDraftSlot,
  type CandidateListTabData,
  type CandidateListView,
  type ReviewerOption,
} from "./candidate-list-shared";

export {
  CANDIDATE_LIST_STATUS_LABELS,
  MIN_MEMOS_PER_CANDIDATE,
  type CandidateDraft,
  type CandidateDraftEntry,
  type CandidateDraftSlot,
  type CandidateListTabData,
  type CandidateListView,
  type ReviewerOption,
} from "./candidate-list-shared";

/**
 * 섭외 후보 리스트 (기획 승인 2026-11-07 — 2단계).
 *
 * 리스트의 **내용**은 섭외후보 등록 탭의 자리(engagement_slot_positions)다. 이 모듈은
 *  1) 지금 자리 상태로 '초안'을 만들고(buildCandidateDraft),
 *  2) 내부 검토를 요청하는 시점에 그 초안을 candidate_lists/entries에 스냅샷으로 굳히고,
 *  3) 탭이 보여 줄 리스트·검토·의견을 한 번에 읽는다(loadCandidateListTab).
 * 자격메모 3개 게이트(07번)는 프로젝트 안에서 그 후보에게 남긴 메모 수로 판정한다.
 */

/** 지금 자리 상태로 리스트 초안을 만든다 — 전문가가 붙은 자리(취소 제외)만 */
export async function buildCandidateDraft(supabase: Db, projectId: string): Promise<CandidateDraft> {
  const { data: slots } = await supabase
    .from("engagement_slots")
    .select(
      `id, slot_date, period_end_date, starts_time, ends_time, session_name, role_type, role_description, required_count, fee_amount, unit_fee_online, unit_fee_offline, ${SLOT_SCHEDULE_COLUMNS}`
    )
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .order("starts_time", { ascending: true, nullsFirst: true });
  const slotRows = slots ?? [];
  if (slotRows.length === 0) return { slots: [], candidateCount: 0, shortOnMemos: [] };
  const slotIds = slotRows.map((s) => s.id);
  const [dates, { data: positions }] = await Promise.all([
    loadSlotDates(supabase, slotIds),
    supabase
      .from("engagement_slot_positions")
      .select("id, slot_id, code, rank, position_no, status, expert_id, assigned_expert_id, expected_fee, expected_fee_max, unit_fee_online, unit_fee_offline, fee_custom")
      .in("slot_id", slotIds)
      .neq("status", "canceled")
      .order("rank", { ascending: true })
      .order("position_no", { ascending: true }),
  ]);
  const live = (positions ?? []).filter((p) => p.expert_id ?? p.assigned_expert_id);
  const expertIds = Array.from(new Set(live.map((p) => (p.expert_id ?? p.assigned_expert_id) as string)));
  const [{ data: experts }, memosRes] = await Promise.all([
    expertIds.length > 0
      ? supabase.from("experts").select("id, name").in("id", expertIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    expertIds.length > 0
      ? supabase
          .from("expert_qualification_memos")
          .select("id, expert_id, body, created_by, created_at")
          .eq("project_id", projectId)
          .in("expert_id", expertIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; expert_id: string; body: string; created_by: string | null; created_at: string }[], error: null }),
  ]);
  const memoRows = memosRes.error && isMissingTableError(memosRes.error) ? [] : memosRes.data ?? [];
  const authorIds = Array.from(new Set(memoRows.map((m) => m.created_by).filter((v): v is string => Boolean(v))));
  const { data: authors } = authorIds.length > 0
    ? await supabase.from("users").select("id, name").in("id", authorIds)
    : { data: [] as { id: string; name: string }[] };
  const authorName = new Map((authors ?? []).map((u) => [u.id, u.name]));
  const expertName = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const memosByExpert = new Map<string, CandidateDraftEntry["memos"]>();
  for (const m of memoRows) {
    const list = memosByExpert.get(m.expert_id) ?? [];
    list.push({ id: m.id, body: m.body, authorName: m.created_by ? authorName.get(m.created_by) ?? null : null, createdAt: m.created_at });
    memosByExpert.set(m.expert_id, list);
  }

  const draftSlots: CandidateDraftSlot[] = slotRows.map((s) => {
    const schedule = scheduleFromRow(s, dates.get(s.id) ?? []);
    const sessionLabel = `${describeSchedule(schedule, { withYear: true, withMeta: true, formal: true })}${s.session_name ? ` · ${s.session_name}` : ""}`;
    const roleLabel = [roleTypeLabel(s.role_type), s.role_description].filter(Boolean).join(" · ") || null;
    const entries = live
      .filter((p) => p.slot_id === s.id)
      .map((p, i) => {
        const expertId = (p.expert_id ?? p.assigned_expert_id) as string;
        const unitOnline = p.unit_fee_online ?? s.unit_fee_online;
        const unitOffline = p.unit_fee_offline ?? s.unit_fee_offline;
        const total =
          p.fee_custom && p.unit_fee_online === null && p.unit_fee_offline === null && p.expected_fee !== null
            ? { min: p.expected_fee, max: p.expected_fee_max ?? p.expected_fee, note: null }
            : computeFeeTotal(schedule, unitOnline, unitOffline);
        const feeText = total ? formatFeeTotal(total) : p.expected_fee !== null ? `${p.expected_fee.toLocaleString("ko-KR")}원` : s.fee_amount ? `${s.fee_amount.toLocaleString("ko-KR")}원` : null;
        return {
          slotId: s.id,
          positionId: p.id,
          expertId,
          expertName: expertName.get(expertId) ?? "(이름 없음)",
          rank: p.rank ?? i + 1,
          code: p.code,
          sessionLabel,
          roleLabel,
          unitFeeOnline: unitOnline,
          unitFeeOffline: unitOffline,
          totalFeeMin: total?.min ?? p.expected_fee ?? null,
          totalFeeMax: total?.max ?? p.expected_fee_max ?? p.expected_fee ?? null,
          feeText,
          memos: memosByExpert.get(expertId) ?? [],
        };
      });
    return { slotId: s.id, sessionLabel, sessionName: s.session_name, roleLabel, requiredCount: s.required_count, entries };
  });
  const seen = new Map<string, { expertName: string; count: number }>();
  for (const sl of draftSlots) for (const e of sl.entries) {
    if (!seen.has(e.expertId)) seen.set(e.expertId, { expertName: e.expertName, count: e.memos.length });
  }
  const shortOnMemos = Array.from(seen.entries())
    .filter(([, v]) => v.count < MIN_MEMOS_PER_CANDIDATE)
    .map(([expertId, v]) => ({ expertId, expertName: v.expertName, count: v.count }));
  return { slots: draftSlots, candidateCount: seen.size, shortOnMemos };
}

/**
 * 리스트 작성 탭이 쓰는 모든 데이터 — RLS가 열람 범위를 정한다.
 * fallbackToSubmitted: 살아 있는 리스트가 없으면 가장 최근 '품의 상신됨' 리스트를 돌려준다 —
 * 섭외후보 조정 탭이 반려 뒤 재상신할 때 같은 의견·회신을 다시 첨부하기 위해 (4단계).
 */
export async function loadCandidateListTab(
  projectId: string,
  opts?: { fallbackToSubmitted?: boolean }
): Promise<CandidateListTabData> {
  const supabase = createClient();
  const [draft, listsRes, usersRes] = await Promise.all([
    buildCandidateDraft(supabase, projectId),
    supabase
      .from("candidate_lists")
      .select("id, revision, status, title, note, created_by, internal_requested_at, internal_done_at, created_at")
      .eq("project_id", projectId)
      .order("revision", { ascending: false }),
    // 내부 검토자 후보 — 이사·대표 등급 (기본 전원 체크, 담당자가 조정)
    supabase.from("users").select("id, name, grade, is_active, positions(name)").eq("is_active", true).in("grade", ["director", "ceo"]).order("name"),
  ]);
  const reviewerOptions: ReviewerOption[] = (usersRes.data ?? []).map((u) => {
    const pos = u.positions as { name: string } | { name: string }[] | null;
    return { id: u.id, name: u.name, grade: (u as { grade?: string | null }).grade ?? null, positionName: Array.isArray(pos) ? pos[0]?.name ?? null : pos?.name ?? null };
  });
  if (listsRes.error) {
    if (isMissingTableError(listsRes.error)) return { ready: false, draft, list: null, history: [], reviewerOptions };
    return { ready: true, draft, list: null, history: [], reviewerOptions };
  }
  const lists = listsRes.data ?? [];
  const liveRow =
    lists.find((l) => l.status !== "submitted" && l.status !== "superseded") ??
    (opts?.fallbackToSubmitted ? lists.find((l) => l.status === "submitted") ?? null : null);
  const history = lists.filter((l) => l.id !== liveRow?.id).map((l) => ({ id: l.id, revision: l.revision, status: l.status, createdAt: l.created_at }));
  if (!liveRow) return { ready: true, draft, list: null, history, reviewerOptions };

  const [{ data: entries }, { data: reviews }, { data: comments }] = await Promise.all([
    supabase.from("candidate_list_entries").select("*").eq("list_id", liveRow.id).order("rank"),
    supabase.from("candidate_list_reviews").select("*").eq("list_id", liveRow.id).order("requested_at"),
    supabase.from("candidate_list_review_comments").select("*").eq("list_id", liveRow.id).order("created_at"),
  ]);
  const userIds = Array.from(new Set([
    liveRow.created_by,
    ...(reviews ?? []).map((r) => r.reviewer_user_id),
    ...(comments ?? []).map((c) => c.author_user_id),
  ].filter((v): v is string => Boolean(v))));
  const expertIds = Array.from(new Set((entries ?? []).map((e) => e.expert_id)));
  const [{ data: users }, { data: experts }] = await Promise.all([
    userIds.length > 0 ? supabase.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    expertIds.length > 0 ? supabase.from("experts").select("id, name").in("id", expertIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const expertName = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const list: CandidateListView = {
    id: liveRow.id,
    revision: liveRow.revision,
    status: liveRow.status,
    title: liveRow.title,
    note: liveRow.note,
    createdBy: liveRow.created_by,
    createdByName: liveRow.created_by ? userName.get(liveRow.created_by) ?? null : null,
    internalRequestedAt: liveRow.internal_requested_at,
    internalDoneAt: liveRow.internal_done_at,
    entries: (entries ?? []).map((e) => ({
      id: e.id,
      slotId: e.slot_id,
      positionId: e.position_id,
      expertId: e.expert_id,
      expertName: expertName.get(e.expert_id) ?? "(이름 없음)",
      rank: e.rank,
      code: e.code,
      sessionLabel: e.session_label,
      roleLabel: e.role_label,
      feeText:
        e.total_fee_min !== null
          ? e.total_fee_max !== null && e.total_fee_max !== e.total_fee_min
            ? `${e.total_fee_min.toLocaleString("ko-KR")}원 ~ ${e.total_fee_max.toLocaleString("ko-KR")}원`
            : `${e.total_fee_min.toLocaleString("ko-KR")}원`
          : null,
      memoCount: e.memo_count,
    })),
    reviews: (reviews ?? []).map((r) => ({
      id: r.id,
      reviewerUserId: r.reviewer_user_id,
      reviewerName: userName.get(r.reviewer_user_id) ?? "(이름 없음)",
      status: r.status,
      requestedAt: r.requested_at,
      doneAt: r.done_at,
    })),
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      entryId: c.entry_id,
      authorUserId: c.author_user_id,
      authorName: userName.get(c.author_user_id) ?? "(이름 없음)",
      body: c.body,
      createdAt: c.created_at,
    })),
  };
  return { ready: true, draft, list, history, reviewerOptions };
}

