import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/supabase/errors";
import { loadCandidateListTab } from "./candidate-lists";
import { isClientOpinion, type ClientOpinion, type ClientResponseView } from "./client-review-shared";
import type { AdjustAnnotation, AdjustTabData } from "./adjust-tab-shared";

export { composePlanDoc, type AdjustTabData, type AdjustAttachment } from "./adjust-tab-shared";

/**
 * 섭외후보 조정 탭 데이터 (기획 승인 2026-11-07 — 4단계).
 * 지금 자리(초안) + 살아 있는 리스트(스냅샷·내부 의견) + 발주처 회신을 한 번에 읽고,
 * 자리마다 "누가 무슨 의견을 냈는지"를 붙인다. 품의서 본문은 composePlanDoc이 이 데이터로 만든다.
 */
export async function loadAdjustTab(projectId: string): Promise<AdjustTabData> {
  // 살아 있는 리스트가 없으면 최근 상신 리스트를 쓴다 — 반려 뒤 재상신에도 같은 의견·회신이 첨부된다
  const base = await loadCandidateListTab(projectId, { fallbackToSubmitted: true });
  const empty: AdjustTabData = {
    ready: base.ready,
    draft: base.draft,
    list: base.list,
    responses: [],
    annotations: {},
    removed: [],
    generalComments: [],
  };
  const list = base.list;
  // 자리 → 빈 주석 (리스트 없으면 전부 새 후보가 아니라 '해당 없음')
  for (const s of base.draft.slots) for (const e of s.entries) {
    empty.annotations[e.positionId] = { internalComments: [], clientOpinions: [], isNew: false };
  }
  if (!list) return empty;

  const supabase = createClient();
  const { data: responseRows, error } = await supabase
    .from("client_review_responses")
    .select("*")
    .eq("list_id", list.id)
    .order("round", { ascending: true });
  let responses: ClientResponseView[] = [];
  if (!error && responseRows && responseRows.length > 0) {
    const { data: items } = await supabase
      .from("client_review_response_items")
      .select("response_id, entry_id, opinion, comment")
      .in("response_id", responseRows.map((r) => r.id));
    responses = responseRows.map((r) => ({
      id: r.id,
      round: r.round,
      respondentName: r.respondent_name,
      generalComment: r.general_comment,
      submittedAt: r.submitted_at,
      items: (items ?? [])
        .filter((i) => i.response_id === r.id)
        .map((i) => ({ entryId: i.entry_id, opinion: isClientOpinion(i.opinion) ? i.opinion : ("hold" as ClientOpinion), comment: i.comment })),
    }));
  } else if (error && !isMissingTableError(error)) {
    responses = [];
  }

  // 리스트 행 ↔ 지금 자리 매칭: position_id 우선, 없으면 같은 세션의 같은 전문가, 없으면 전문가만
  const entryByPosition = new Map(list.entries.filter((e) => e.positionId).map((e) => [e.positionId as string, e]));
  const entryBySlotExpert = new Map(list.entries.map((e) => [`${e.slotId ?? ""}:${e.expertId}`, e]));
  const entryByExpert = new Map<string, (typeof list.entries)[number]>();
  for (const e of list.entries) if (!entryByExpert.has(e.expertId)) entryByExpert.set(e.expertId, e);

  const commentsByEntry = new Map<string, AdjustAnnotation["internalComments"]>();
  for (const c of list.comments) {
    if (!c.entryId) continue;
    const arr = commentsByEntry.get(c.entryId) ?? [];
    arr.push({ authorName: c.authorName, body: c.body, createdAt: c.createdAt });
    commentsByEntry.set(c.entryId, arr);
  }
  const opinionsByEntry = new Map<string, AdjustAnnotation["clientOpinions"]>();
  for (const r of responses) for (const it of r.items) {
    const arr = opinionsByEntry.get(it.entryId) ?? [];
    arr.push({ round: r.round, opinion: it.opinion, comment: it.comment });
    opinionsByEntry.set(it.entryId, arr);
  }

  const annotations: Record<string, AdjustAnnotation> = {};
  const matchedEntryIds = new Set<string>();
  for (const s of base.draft.slots) for (const e of s.entries) {
    const entry =
      entryByPosition.get(e.positionId) ?? entryBySlotExpert.get(`${e.slotId}:${e.expertId}`) ?? entryByExpert.get(e.expertId) ?? null;
    if (entry) matchedEntryIds.add(entry.id);
    annotations[e.positionId] = {
      internalComments: entry ? commentsByEntry.get(entry.id) ?? [] : [],
      clientOpinions: entry ? opinionsByEntry.get(entry.id) ?? [] : [],
      isNew: !entry,
    };
  }
  const removed = list.entries
    .filter((e) => !matchedEntryIds.has(e.id))
    .map((e) => ({
      expertName: e.expertName,
      code: e.code,
      sessionLabel: e.sessionLabel,
      opinions: (opinionsByEntry.get(e.id) ?? []).map((o) => o.opinion),
    }));

  return {
    ready: true,
    draft: base.draft,
    list,
    responses,
    annotations,
    removed,
    generalComments: list.comments.filter((c) => c.entryId === null).map((c) => ({ authorName: c.authorName, body: c.body, createdAt: c.createdAt })),
  };
}
