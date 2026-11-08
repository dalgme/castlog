import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  HISTORY_OUTCOME_LABELS,
  HISTORY_OUTCOME_TONE,
  shortKst,
  type EngagementHistoryBoard,
  type HistoryAttempt,
  type HistoryCandidateRow,
} from "@/lib/integrations/engagement-history";

/**
 * 섭외 현황판 (기획 지시 2026-11-08, 17번) — 품의 승인 뒤 섭외가 진행되는 동안
 * 세션별로 후보 순위·요청·결과를 한 표에 모아 "누가 안 되어서 몇 순위가 섭외되었나"가
 * 바로 읽히게 한다. 내부용 요약표 — 전문가 화면에는 나가지 않는다. 읽기 전용(서버 컴포넌트).
 */

const TONE_CLASS: Record<(typeof HISTORY_OUTCOME_TONE)[keyof typeof HISTORY_OUTCOME_TONE], string> = {
  green: "bg-emerald-100 text-emerald-800 border-emerald-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  red: "bg-rose-100 text-rose-800 border-rose-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
  blue: "bg-sky-100 text-sky-800 border-sky-200",
};

function OutcomeBadge({ outcome }: { outcome: HistoryCandidateRow["outcome"] }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[HISTORY_OUTCOME_TONE[outcome]]
      )}
    >
      {HISTORY_OUTCOME_LABELS[outcome]}
    </span>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

function AttemptLine({ attempt, dim }: { attempt: HistoryAttempt; dim: boolean }) {
  // 발송 이력(요청·재안내·동의·거절·수락서…)을 시간순 한 줄로
  const trail = attempt.events.length
    ? attempt.events.map((v) => `${v.label} ${fmtDateTime(v.at)}`).join(" → ")
    : `요청 ${fmtDateTime(attempt.requestedAt)}${attempt.respondedAt ? ` → 응답 ${fmtDateTime(attempt.respondedAt)}` : ""}`;
  return (
    <div className={cn("text-xs leading-relaxed", dim ? "text-muted-foreground" : "text-foreground")}>
      <span className="font-medium">{attempt.expertName}</span>
      <span className="mx-1 text-muted-foreground">·</span>
      <span>{trail}</span>
      {attempt.responseNote && (
        <span className="ml-1 text-muted-foreground">— 사유: {attempt.responseNote}</span>
      )}
    </div>
  );
}

export function EngagementHistoryBoardView({ board }: { board: EngagementHistoryBoard }) {
  if (board.slots.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">섭외 현황판 — 후보 순위별 섭외 히스토리</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              품의 승인 뒤 세션마다 순위대로 누가 요청을 받았고 어떻게 끝났는지(수락·거절·만료·회수)를 모아 보여 줍니다.
              내부용 요약표입니다 — 전문가에게는 보이지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Stat label="필요인원" value={`${board.totals.required}`} />
            <Stat label="확정" value={`${board.totals.confirmed}`} tone="green" />
            <Stat label="요청중" value={`${board.totals.waiting}`} tone="amber" />
            <Stat label="불발(거절·만료·회수)" value={`${board.totals.failed}`} tone="red" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!board.hasActivity && (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            아직 섭외 요청이 나간 세션이 없습니다. 요청·응답이 생기면 여기에 순위별 결과가 쌓입니다.
          </p>
        )}
        {board.slots.map((slot) => {
          const done = slot.confirmed >= slot.requiredCount && slot.requiredCount > 0;
          return (
            <details key={slot.slotId} open className="rounded-lg border">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-semibold text-brand-navy">{slot.label}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-semibold",
                      done ? TONE_CLASS.green : slot.waiting > 0 ? TONE_CLASS.amber : TONE_CLASS.gray
                    )}
                  >
                    확정 {slot.confirmed}/{slot.requiredCount}
                  </span>
                  {slot.failed > 0 && (
                    <span className={cn("rounded-full border px-2 py-0.5 font-semibold", TONE_CLASS.red)}>
                      불발 {slot.failed}
                    </span>
                  )}
                </span>
              </summary>
              <div className="border-t px-3 py-2">
                <p className="mb-2 text-xs leading-relaxed text-foreground">
                  <span className="font-semibold text-muted-foreground">요약 · </span>
                  {slot.narrative}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-1.5 pr-2 font-medium">순위</th>
                        <th className="py-1.5 pr-2 font-medium">코드</th>
                        <th className="py-1.5 pr-2 font-medium">후보</th>
                        <th className="py-1.5 pr-2 font-medium">결과</th>
                        <th className="py-1.5 pr-2 font-medium">요청 · 응답 이력</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slot.rows.map((r) => {
                        const confirmed = r.outcome === "accepted" || r.outcome === "manual_accepted";
                        const last = r.attempts[r.attempts.length - 1];
                        return (
                          <tr
                            key={r.positionId}
                            className={cn(
                              "border-b last:border-b-0 align-top",
                              confirmed && "bg-emerald-50/60",
                              r.outcome === "empty" && "text-muted-foreground"
                            )}
                          >
                            <td className="py-1.5 pr-2 whitespace-nowrap font-semibold tabular-nums">
                              {r.rank}순위{r.isTarget ? " ★" : ""}
                              {!r.isTarget && <span className="ml-1 font-normal text-muted-foreground">예비</span>}
                            </td>
                            <td className="py-1.5 pr-2 whitespace-nowrap font-mono text-[11px]">{r.code}</td>
                            <td className="py-1.5 pr-2 whitespace-nowrap font-medium">{r.expertName ?? "-"}</td>
                            <td className="py-1.5 pr-2">
                              <OutcomeBadge outcome={r.outcome} />
                              {last?.respondedAt && (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">{shortKst(last.respondedAt)}</div>
                              )}
                            </td>
                            <td className="py-1.5 pr-2">
                              {r.attempts.length === 0 ? (
                                <span className="text-muted-foreground">
                                  {r.expertName ? "요청 전" : "-"}
                                </span>
                              ) : (
                                <div className="space-y-0.5">
                                  {r.attempts.map((a, i) => (
                                    <AttemptLine key={a.engagementId} attempt={a} dim={i < r.attempts.length - 1} />
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" }) {
  return (
    <span className={cn("rounded-md border px-2 py-1", tone ? TONE_CLASS[tone] : "bg-white text-foreground")}>
      <span className="text-muted-foreground">{label}</span> <b className="tabular-nums">{value}</b>
    </span>
  );
}
