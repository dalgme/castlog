import "server-only";

import { createClient } from "@/lib/supabase/server";
import { ENGAGEMENT_EVENT_LABELS, type EngagementEventType } from "./engagement-events";

/**
 * 섭외 현황판 — 세션(코드넘버)별 **후보 순위 섭외 히스토리** (기획 지시 2026-11-08, 17번).
 *
 * "누가 섭외가 안 되어서 몇 순위가 섭외되었나"를 품의 승인 뒤 진행 과정 그대로 보여 준다.
 * 자리(engagement_slot_positions)는 거절·만료되면 포인터가 지워져 결과가 남지 않으므로,
 * 섭외 건(expert_engagements.position_code)과 이력 로그(engagement_events)로 되짚는다.
 * 읽기 전용 — 열람 범위는 두 테이블의 RLS(자사 임직원·프로젝트 열람·연습모드)가 정한다.
 */

export type HistoryOutcome =
  | "accepted" // 수락(계약 성립)
  | "manual_accepted" // 수동 처리로 섭외 완료
  | "requested" // 요청중(응답 대기)
  | "declined"
  | "expired"
  | "withdrawn" // 응답 전 회수
  | "urgent_canceled" // 확정 뒤 긴급 취소
  | "unrequested" // 배정만 되어 있고 요청은 아직
  | "empty"; // 후보 없음

export const HISTORY_OUTCOME_LABELS: Record<HistoryOutcome, string> = {
  accepted: "수락 · 확정",
  manual_accepted: "섭외 완료(수동)",
  requested: "요청중",
  declined: "거절",
  expired: "요청 만료",
  withdrawn: "요청 회수",
  urgent_canceled: "긴급 취소",
  unrequested: "미요청(배정만)",
  empty: "후보 없음",
};

export const HISTORY_OUTCOME_TONE: Record<HistoryOutcome, "green" | "amber" | "red" | "gray" | "blue"> = {
  accepted: "green",
  manual_accepted: "green",
  requested: "amber",
  declined: "red",
  expired: "red",
  withdrawn: "gray",
  urgent_canceled: "red",
  unrequested: "blue",
  empty: "gray",
};

export type HistoryEvent = {
  at: string;
  label: string;
  actor: string;
  note: string | null;
};

/** 한 후보에게 보낸 섭외 요청 한 건의 결과 */
export type HistoryAttempt = {
  engagementId: string;
  expertName: string;
  outcome: HistoryOutcome;
  requestedAt: string;
  respondedAt: string | null;
  /** 전문가가 남긴 응답 메모(거절 사유 등) */
  responseNote: string | null;
  events: HistoryEvent[];
};

export type HistoryCandidateRow = {
  positionId: string;
  code: string;
  rank: number;
  /** 순위 상위 필요인원 안(섭외 대상)인가 — 아니면 예비 후보 */
  isTarget: boolean;
  /** 현재 자리에 붙은(또는 배정된) 전문가 */
  expertName: string | null;
  /** 가장 최근 요청의 결과 — 요청이 없으면 unrequested/empty */
  outcome: HistoryOutcome;
  attempts: HistoryAttempt[];
};

export type HistorySlot = {
  slotId: string;
  label: string;
  requiredCount: number;
  rows: HistoryCandidateRow[];
  confirmed: number;
  failed: number;
  waiting: number;
  /** "1순위 A 거절 → 2순위 B 만료 → 5순위 E 수락(확정)" */
  narrative: string;
};

export type EngagementHistoryBoard = {
  slots: HistorySlot[];
  /** 요청이 한 건이라도 나간 적이 있는가 — 없으면 현황판 대신 안내만 */
  hasActivity: boolean;
  totals: { required: number; confirmed: number; failed: number; waiting: number };
};

export type BoardSlotInput = {
  id: string;
  label: string;
  requiredCount: number;
  positions: {
    id: string;
    code: string;
    rank: number;
    status: string;
    expertName: string | null;
    assignedExpertName: string | null;
  }[];
};

type EngagementRow = {
  id: string;
  expert_id: string;
  position_code: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
  response_note: string | null;
  experts: { name: string } | null;
};

type EventRow = {
  engagement_id: string;
  event_type: string;
  actor_label: string;
  note: string | null;
  created_at: string;
};

const FAILED: ReadonlySet<HistoryOutcome> = new Set<HistoryOutcome>(["declined", "expired", "withdrawn", "urgent_canceled"]);
const CONFIRMED: ReadonlySet<HistoryOutcome> = new Set<HistoryOutcome>(["accepted", "manual_accepted"]);

function outcomeOf(e: EngagementRow, events: EventRow[]): HistoryOutcome {
  switch (e.status) {
    case "accepted":
      return events.some((v) => v.event_type === "manual_accepted") ? "manual_accepted" : "accepted";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "canceled":
      // 취소는 두 갈래 — 응답 전 회수 / 확정 뒤 긴급 취소. 이력 로그가 가른다
      return events.some((v) => v.event_type === "urgent_canceled") || e.responded_at
        ? "urgent_canceled"
        : "withdrawn";
    default:
      return "requested";
  }
}

export function shortKst(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
}

/** 순수 조립 — 테스트·재사용을 위해 조회와 분리 */
export function buildEngagementHistoryBoard(
  slots: BoardSlotInput[],
  engagements: EngagementRow[],
  events: EventRow[]
): EngagementHistoryBoard {
  const eventsByEngagement = new Map<string, EventRow[]>();
  for (const v of events) {
    const list = eventsByEngagement.get(v.engagement_id) ?? [];
    list.push(v);
    eventsByEngagement.set(v.engagement_id, list);
  }
  const attemptsByCode = new Map<string, HistoryAttempt[]>();
  for (const e of engagements) {
    if (!e.position_code) continue;
    const evs = (eventsByEngagement.get(e.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const attempt: HistoryAttempt = {
      engagementId: e.id,
      expertName: e.experts?.name ?? "전문가",
      outcome: outcomeOf(e, evs),
      requestedAt: e.created_at,
      respondedAt: e.responded_at,
      responseNote: e.response_note,
      events: evs.map((v) => ({
        at: v.created_at,
        label: ENGAGEMENT_EVENT_LABELS[v.event_type as EngagementEventType] ?? v.event_type,
        actor: v.actor_label,
        note: v.note,
      })),
    };
    const list = attemptsByCode.get(e.position_code) ?? [];
    list.push(attempt);
    attemptsByCode.set(e.position_code, list);
  }

  let hasActivity = false;
  const totals = { required: 0, confirmed: 0, failed: 0, waiting: 0 };
  const out: HistorySlot[] = [];
  for (const slot of slots) {
    const positions = slot.positions.slice().sort((a, b) => a.rank - b.rank);
    // 후보가 하나도 없는 세션은 현황판에 올릴 것이 없다
    if (!positions.some((p) => p.expertName || p.assignedExpertName || attemptsByCode.has(p.code))) continue;
    const rows: HistoryCandidateRow[] = positions.map((p) => {
      const attempts = (attemptsByCode.get(p.code) ?? []).slice().sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      const last = attempts[attempts.length - 1];
      const expertName = p.expertName ?? p.assignedExpertName ?? last?.expertName ?? null;
      const outcome: HistoryOutcome = last ? last.outcome : expertName ? "unrequested" : "empty";
      return {
        positionId: p.id,
        code: p.code,
        rank: p.rank,
        isTarget: p.rank <= slot.requiredCount,
        expertName,
        outcome,
        attempts,
      };
    });
    if (rows.some((r) => r.attempts.length > 0)) hasActivity = true;
    const confirmed = rows.filter((r) => CONFIRMED.has(r.outcome)).length;
    // 불발 = 거절·만료·회수·긴급취소로 끝난 요청 건수 (같은 후보에게 다시 보낸 것도 각각 센다)
    const failed = rows.reduce((n, r) => n + r.attempts.filter((a) => FAILED.has(a.outcome)).length, 0);
    const waiting = rows.filter((r) => r.outcome === "requested").length;
    totals.required += slot.requiredCount;
    totals.confirmed += confirmed;
    totals.failed += failed;
    totals.waiting += waiting;

    // 서술 — 순위대로 "불발 → 확정"을 한 줄로. 요청이 없던 예비 후보는 적지 않는다
    const parts: string[] = [];
    for (const r of rows) {
      for (const a of r.attempts) {
        if (!FAILED.has(a.outcome)) continue;
        parts.push(`${r.rank}순위 ${a.expertName} ${HISTORY_OUTCOME_LABELS[a.outcome]}(${shortKst(a.respondedAt ?? a.requestedAt)})`);
      }
    }
    const tail: string[] = [];
    for (const r of rows) {
      if (CONFIRMED.has(r.outcome)) tail.push(`${r.rank}순위 ${r.expertName ?? "전문가"} 수락 · 확정`);
      else if (r.outcome === "requested") tail.push(`${r.rank}순위 ${r.expertName ?? "전문가"} 요청중`);
    }
    const narrative =
      parts.length === 0 && tail.length === 0
        ? "아직 섭외 요청이 나가지 않았습니다."
        : [...parts, ...tail].join(" → ");

    out.push({ slotId: slot.id, label: slot.label, requiredCount: slot.requiredCount, rows, confirmed, failed, waiting, narrative });
  }
  return { slots: out, hasActivity, totals };
}

export async function loadEngagementHistoryBoard(projectId: string, slots: BoardSlotInput[]): Promise<EngagementHistoryBoard> {
  const supabase = createClient();
  const { data: engagementRows } = await supabase
    .from("expert_engagements")
    .select("id, expert_id, position_code, status, created_at, responded_at, response_note, experts (name)")
    .eq("project_id", projectId)
    .not("position_code", "is", null)
    .order("created_at", { ascending: true })
    .limit(2000);
  const engagements = (engagementRows ?? []) as EngagementRow[];
  const ids = engagements.map((e) => e.id);
  const { data: eventRows } = ids.length
    ? await supabase
        .from("engagement_events")
        .select("engagement_id, event_type, actor_label, note, created_at")
        .in("engagement_id", ids)
        .order("created_at", { ascending: true })
        .limit(5000)
    : { data: [] as EventRow[] };
  return buildEngagementHistoryBoard(slots, engagements, (eventRows ?? []) as EventRow[]);
}
