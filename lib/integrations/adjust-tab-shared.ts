/**
 * 섭외후보 조정 탭 — 서버·클라이언트 공용 타입과 품의서 본문 작성기 (기획 승인 2026-11-07 — 4단계, 03·05·10번).
 * 조회·저장은 lib/integrations/adjust-tab.ts(server-only) · adjust-actions.ts에 있다.
 *
 * 품의서 본문(note)과 첨부는 **순수 함수**로 만든다 — 화면 미리보기(04번)와 서버 상신이
 * 같은 함수를 쓰므로 "본 것과 올라간 것"이 다를 수 없다.
 */

import type { CandidateDraft, CandidateListView } from "./candidate-list-shared";
import { CANDIDATE_LIST_STATUS_LABELS } from "./candidate-list-shared";
import { CLIENT_OPINION_LABELS, type ClientOpinion, type ClientResponseView } from "./client-review-shared";

export const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  client_review_response: "발주처 회신",
  internal_review: "내부 검토 의견",
  candidate_list: "섭외 후보 리스트",
  file: "파일",
};

export type AdjustAttachment = {
  kind: "client_review_response" | "internal_review" | "candidate_list";
  /** 원본 레코드 id (회신 id · 리스트 id) */
  refId: string | null;
  title: string;
  bodyText: string;
};

/** 자리(positionId)마다 붙는 주석 — 내부 검토 의견·발주처 의견·새 후보 여부 */
export type AdjustAnnotation = {
  internalComments: { authorName: string; body: string; createdAt: string }[];
  clientOpinions: { round: number; opinion: ClientOpinion; comment: string | null }[];
  /** 리스트 스냅샷에 없던 후보 — 검토 뒤 새로 넣은 사람 */
  isNew: boolean;
};

export type AdjustTabData = {
  /** 리스트 표가 있는가 (마이그레이션 0013) */
  ready: boolean;
  draft: CandidateDraft;
  /** 살아 있는 리스트 (내부 검토 중 ~ 후보 조정 중) — 없으면 리스트 없이 품의 */
  list: CandidateListView | null;
  responses: ClientResponseView[];
  annotations: Record<string, AdjustAnnotation>;
  /** 리스트에는 있었지만 지금 자리에서 빠진 후보 */
  removed: { expertName: string; code: string; sessionLabel: string; opinions: ClientOpinion[] }[];
  /** 리스트 전체 의견 (entryId null) */
  generalComments: { authorName: string; body: string; createdAt: string }[];
};

export type ComposedPlanDoc = { note: string; attachments: AdjustAttachment[] };

function fmtKst(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function circled(i: number): string {
  const marks = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return marks[i] ?? `${i + 1}.`;
}

/**
 * 품의서 본문 + 첨부를 만든다.
 * - 세션별 후보(순위★·코드·이름·의뢰비용)와 자격메모 요약
 * - 후보마다 내부 검토 의견·발주처 의견 한 줄씩
 * - 내부 검토 요약 · 발주처 회신 요약
 * - 첨부: 발주처 회신 원문(라운드별) · 내부 검토 의견 전문 · 리스트 스냅샷
 * slotIds가 있으면 그 세션만 본문에 담는다 (세션별 선택 상신 — 22번). 첨부는 리스트 전체다.
 */
export function composePlanDoc(data: AdjustTabData, slotIds: string[] | null): ComposedPlanDoc {
  const { draft, list, responses, annotations } = data;
  const pick = slotIds && slotIds.length > 0 ? new Set(slotIds) : null;
  const slots = draft.slots.filter((s) => !pick || pick.has(s.slotId));
  const lines: string[] = [];

  lines.push("■ 섭외 후보 (세션별 · ★ = 필요인원 안 섭외 대상)");
  if (slots.length === 0) lines.push("  (담긴 세션 없음)");
  for (const s of slots) {
    lines.push(`▶ ${s.sessionLabel}${s.roleLabel ? ` [${s.roleLabel}]` : ""} — 필요인원 ${s.requiredCount}명 · 후보 ${s.entries.length}명`);
    s.entries.forEach((e, i) => {
      const star = i < s.requiredCount ? "★" : " ";
      lines.push(`  ${e.rank}순위${star} ${e.code} ${e.expertName} — 의뢰비용 ${e.feeText ?? "미정"}`);
      if (e.memos.length > 0) {
        const memos = e.memos.slice().reverse().map((m, j) => `${circled(j)} ${m.body}`).join("  ");
        lines.push(`     자격메모: ${memos}`);
      } else {
        lines.push("     자격메모: 없음");
      }
      const a = annotations[e.positionId];
      if (a) {
        if (a.isNew && list) lines.push("     ※ 검토 리스트 이후 새로 넣은 후보");
        if (a.internalComments.length > 0) {
          lines.push(`     내부 검토: ${a.internalComments.map((c) => `${c.authorName} "${c.body}"`).join(" / ")}`);
        }
        if (a.clientOpinions.length > 0) {
          lines.push(
            `     발주처: ${a.clientOpinions
              .map((o) => `${o.round}라운드 ${CLIENT_OPINION_LABELS[o.opinion]}${o.comment ? ` "${o.comment}"` : ""}`)
              .join(" / ")}`
          );
        }
      }
    });
  }

  const attachments: AdjustAttachment[] = [];

  if (!list) {
    lines.push("");
    lines.push("※ 섭외 후보 리스트(내부 검토·발주처 검토)를 거치지 않고 올리는 품의입니다.");
    return { note: lines.join("\n"), attachments };
  }

  // 내부 검토 요약
  lines.push("");
  const done = list.reviews.filter((r) => r.status === "done");
  lines.push(`■ 내부 검토 — ${list.title} (${CANDIDATE_LIST_STATUS_LABELS[list.status] ?? list.status}) · 검토자 ${done.length}/${list.reviews.length}명 완료`);
  lines.push(`  검토자: ${list.reviews.map((r) => `${r.reviewerName}(${r.status === "done" ? "완료" : "미응답"})`).join(", ") || "없음"}`);
  if (data.generalComments.length > 0) {
    for (const c of data.generalComments) lines.push(`  · 전체 의견 — ${c.authorName}: ${c.body}`);
  } else {
    lines.push("  · 전체 의견 없음");
  }
  const perCandidateCount = list.comments.filter((c) => c.entryId !== null).length;
  if (perCandidateCount > 0) lines.push(`  · 후보별 의견 ${perCandidateCount}건 — 위 후보 항목 및 첨부 참조`);

  // 발주처 회신 요약
  lines.push("");
  if (responses.length === 0) {
    lines.push("■ 발주처 검토 — 회신 없음 (건너뜀 또는 미회신)");
  } else {
    lines.push(`■ 발주처 회신 — ${responses.length}건`);
    const entryLabel = new Map(list.entries.map((e) => [e.id, `${e.expertName}(${e.code})`]));
    for (const r of responses.slice().sort((a, b) => a.round - b.round)) {
      const counts = { ok: 0, replace: 0, hold: 0 };
      for (const it of r.items) counts[it.opinion] += 1;
      lines.push(`  ▷ ${r.round}라운드 · ${fmtKst(r.submittedAt)}${r.respondentName ? ` · 회신자 ${r.respondentName}` : ""}`);
      if (r.generalComment) lines.push(`    전체 요청사항: ${r.generalComment}`);
      lines.push(`    후보별: 적합 ${counts.ok} · 교체 요청 ${counts.replace} · 보류 ${counts.hold}`);
      const replace = r.items.filter((it) => it.opinion !== "ok");
      for (const it of replace) {
        lines.push(`    - [${CLIENT_OPINION_LABELS[it.opinion]}] ${entryLabel.get(it.entryId) ?? "후보"}${it.comment ? `: ${it.comment}` : ""}`);
      }
    }
    if (data.removed.length > 0) {
      lines.push(`  조정 결과 제외된 후보: ${data.removed.map((x) => `${x.expertName}(${x.code})`).join(", ")}`);
    }
  }

  // 첨부
  for (const r of responses.slice().sort((a, b) => a.round - b.round)) {
    const entryLabel = new Map(list.entries.map((e) => [e.id, `${e.expertName}(${e.code}) · ${e.sessionLabel}`]));
    const body = [
      `${list.title} — 발주처 회신 ${r.round}라운드`,
      `회신 일시: ${fmtKst(r.submittedAt)}`,
      `회신자: ${r.respondentName ?? "(미기재)"}`,
      "",
      "전체 요청사항:",
      r.generalComment ?? "(없음)",
      "",
      "후보별 의견:",
      ...(r.items.length > 0
        ? r.items.map((it) => `- [${CLIENT_OPINION_LABELS[it.opinion]}] ${entryLabel.get(it.entryId) ?? "후보"}${it.comment ? ` — ${it.comment}` : ""}`)
        : ["(없음)"]),
    ].join("\n");
    attachments.push({
      kind: "client_review_response",
      refId: r.id,
      title: `발주처 회신 ${r.round}라운드${r.respondentName ? ` (${r.respondentName})` : ""} · ${fmtKst(r.submittedAt, false)}`,
      bodyText: body,
    });
  }
  {
    const entryLabel = new Map(list.entries.map((e) => [e.id, `${e.expertName}(${e.code}) · ${e.sessionLabel}`]));
    const body = [
      `${list.title} — 내부 검토 의견`,
      `요청: ${fmtKst(list.internalRequestedAt)}${list.createdByName ? ` · ${list.createdByName}` : ""}`,
      `완료: ${list.internalDoneAt ? fmtKst(list.internalDoneAt) : "(진행 중)"}`,
      `검토자: ${list.reviews.map((r) => `${r.reviewerName} — ${r.status === "done" ? `완료 ${fmtKst(r.doneAt)}` : "미응답"}`).join(" / ") || "(없음)"}`,
      list.note ? `요청 메모: ${list.note}` : null,
      "",
      "전체 의견:",
      ...(data.generalComments.length > 0 ? data.generalComments.map((c) => `- ${c.authorName} (${fmtKst(c.createdAt)}): ${c.body}`) : ["(없음)"]),
      "",
      "후보별 의견:",
      ...(perCandidateCount > 0
        ? list.comments
            .filter((c) => c.entryId !== null)
            .map((c) => `- ${entryLabel.get(c.entryId as string) ?? "후보"} — ${c.authorName} (${fmtKst(c.createdAt)}): ${c.body}`)
        : ["(없음)"]),
    ]
      .filter((v): v is string => v !== null)
      .join("\n");
    attachments.push({ kind: "internal_review", refId: list.id, title: `내부 검토 의견 — ${list.title}`, bodyText: body });
  }
  {
    const bySlot = new Map<string, typeof list.entries>();
    for (const e of list.entries) {
      const key = e.slotId ?? e.sessionLabel;
      const arr = bySlot.get(key) ?? [];
      arr.push(e);
      bySlot.set(key, arr);
    }
    const body = [
      `${list.title} (스냅샷 · 요청 ${fmtKst(list.internalRequestedAt)})`,
      ...Array.from(bySlot.values()).flatMap((entries) => {
        const head = entries[0];
        if (!head) return [];
        return [
          "",
          `▶ ${head.sessionLabel}${head.roleLabel ? ` [${head.roleLabel}]` : ""}`,
          ...entries.map((e) => `  ${e.rank}순위 ${e.code} ${e.expertName} — 의뢰비용 ${e.feeText ?? "미정"} · 자격메모 ${e.memoCount}개`),
        ];
      }),
    ].join("\n");
    attachments.push({ kind: "candidate_list", refId: list.id, title: `${list.title} (검토 시점 스냅샷)`, bodyText: body });
  }

  lines.push("");
  lines.push(`■ 첨부 ${attachments.length}건: ${attachments.map((a) => a.title).join(" · ")}`);

  return { note: lines.join("\n"), attachments };
}
