import Link from "next/link";
import { BadgeCheck, FileCheck2, Users } from "lucide-react";

import { formatKrw } from "@/lib/approvals/constants";
import { cn } from "@/lib/utils";
import {
  ENGAGEMENT_STAGE_LABELS,
  ENGAGEMENT_STAGE_TONE,
  STAGE_TONE_CLASS,
  type EngagementStage,
} from "@/lib/integrations/engagement-stage";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";

import { EngagementHistoryDialog } from "./engagement-history-dialog";
import { COMPLETED_BADGE_CLASS, CompletionButton } from "./completion-buttons";
import { ExpertEvaluateDialog, RatingStars } from "./expert-evaluate-dialog";
import { ExpertQuickTag } from "../../experts/expert-quick-tag";
import {
  SessionNoticeDialog,
  type NoticeTemplateOption,
  type SessionNoticeRow,
} from "./session-notice-dialog";
import type { ProgressRow } from "./engagement-progress";

/**
 * 섭외 확정 탭 (기획 지시 2026-09-21).
 *
 * '승인 목록 및 섭외 진행'에서 계약이 성립(승인)한 전문가 명단이 여기로 넘어온다.
 * 계획한 세션의 필요인원이 전원 승인되면 '섭외 목표 달성'으로 표시한다.
 * 긴급 취소는 여기서도 유효하다 — 취소하면 진행 탭의 그 자리가 다시 비고
 * 재상신·긴급 진행(전결) 창구가 붙는다. 세션별·전문가별 종료 버튼(보라색)도 여기.
 */

/** 계약 성립 이후 단계 — 이 탭에 싣는 행 */
const CONFIRMED_STAGES: readonly EngagementStage[] = [
  "accepted",
  "letter_issued",
  "letter_sent",
  "confirmed",
];

export type ConfirmedSession = {
  slotId: string;
  label: string;
  detail: string | null;
  requiredCount: number;
  /** 계약 성립(filled) 자리 수 */
  filledCount: number;
  completedAt: string | null;
};

export function EngagementConfirmed({
  tenantSlug,
  projectId,
  canManage,
  canCancel,
  canEvaluate,
  canNotice,
  expertsLite,
  rows,
  sessions,
  evaluations,
  tagByExpert,
  noticeTemplates,
  defaultNoticeBody,
  noticesBySlot,
}: {
  tenantSlug: string;
  projectId: string;
  canManage: boolean;
  canCancel: boolean;
  /** 평가·등급(즐겨찾기/VIP) — expertRecord 축 */
  canEvaluate: boolean;
  /** 안내문자 발송 — sessionNotice 축 (세션 확인 탭에서 이동, 기획 2026-09-21) */
  canNotice: boolean;
  expertsLite: boolean;
  rows: ProgressRow[];
  /** 계획에 담긴(또는 결재 없이 진행하는) 세션 — 목표 산정 기준 */
  sessions: ConfirmedSession[];
  /** `${expertId}:${slotId}` → 저장된 평가 (5점 환산) */
  evaluations: Record<string, { rating: number; opinion: string | null }>;
  /** 전문가 id → 자사 등급 (즐겨찾기/VIP/주의) */
  tagByExpert: Record<string, { tag: string; note: string | null }>;
  noticeTemplates: NoticeTemplateOption[];
  defaultNoticeBody: string;
  /** 세션 id → 안내문자 대상·발송 내역 */
  noticesBySlot: Record<string, { targets: { name: string; code: string }[]; notices: SessionNoticeRow[] }>;
}) {
  const confirmed = rows.filter((r) => CONFIRMED_STAGES.includes(r.stage));
  const required = sessions.reduce((n, s) => n + s.requiredCount, 0);
  const filled = sessions.reduce((n, s) => n + Math.min(s.filledCount, s.requiredCount), 0);
  const achieved = sessions.length > 0 && sessions.every((s) => s.filledCount >= s.requiredCount);
  const bySlot = new Map<string, ProgressRow[]>();
  for (const r of confirmed) {
    const key = r.slotId ?? r.slotLabel;
    const list = bySlot.get(key) ?? [];
    list.push(r);
    bySlot.set(key, list);
  }
  // 세션 순서는 계획 순서(sessions)대로, 계획 밖 세션(옛 데이터)은 뒤에
  const orderedSlotIds = [
    ...sessions.map((s) => s.slotId),
    ...Array.from(bySlot.keys()).filter((id) => !sessions.some((s) => s.slotId === id)),
  ];
  const sessionById = new Map(sessions.map((s) => [s.slotId, s]));

  return (
    <div className="space-y-4">
      <AutoRefresh />
      {/* ── 목표 달성 현황 ─────────────────────────────────────── */}
      <Card
        className={cn(
          achieved ? "border-emerald-300 bg-emerald-50/50" : "border-amber-200 bg-amber-50/30"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BadgeCheck className={cn("h-4 w-4", achieved ? "text-emerald-600" : "text-amber-600")} aria-hidden />
            {achieved ? "섭외 목표 달성 — 계획 인원 전원 승인" : "섭외 진행 중"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">
              아직 계획된 세션이 없습니다. 섭외후보 등록 탭에서 세션·후보를 등록하고 품의를 올린 뒤, 승인 목록 및 섭외 진행 탭에서 승인 처리하면 여기에 명단이 쌓입니다.
            </p>
          ) : (
            <p>
              계획 인원 <strong>{required}명</strong> 중 <strong>{filled}명</strong> 승인
              {achieved
                ? " — 전원 확정되었습니다. 아래 명단이 섭외 확정 인원입니다."
                : " — 남은 자리는 승인 목록 및 섭외 진행 탭에서 처리하세요. 승인된 인원부터 아래에 표시됩니다."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 세션별 확정 명단 ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" aria-hidden />
            섭외 확정 인원 ({confirmed.length}명)
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            긴급 취소는 여기서도 됩니다 — 취소하면 승인 목록 및 섭외 진행 탭에서 그 자리에 대해 변경 품의 재상신 또는 긴급 진행(전결)을 할 수 있습니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {confirmed.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 승인(계약 성립)된 전문가가 없습니다.</p>
          ) : (
            orderedSlotIds.map((slotId) => {
              const list = bySlot.get(slotId) ?? [];
              const session = sessionById.get(slotId);
              if (list.length === 0 && !session) return null;
              const slotDone = session?.completedAt ?? list[0]?.slotCompletedAt ?? null;
              const label = session?.label ?? list[0]?.slotLabel ?? "세션";
              return (
                <div key={slotId} className={cn("rounded-lg border", slotDone && "border-violet-300 bg-violet-50/40")}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {label}
                        {slotDone && <span className={cn("ml-2", COMPLETED_BADGE_CLASS)}>종료</span>}
                      </p>
                      {session?.detail && (
                        <p className="text-[11px] text-muted-foreground">{session.detail}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {session && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            session.filledCount >= session.requiredCount
                              ? "border-emerald-200 bg-emerald-100 text-emerald-900"
                              : "border-amber-200 bg-amber-100 text-amber-900"
                          )}
                        >
                          {Math.min(session.filledCount, session.requiredCount)}/{session.requiredCount}명 확정
                        </span>
                      )}
                      {canManage && session && (
                        <CompletionButton kind="slot" targetId={session.slotId} label={label} completedAt={slotDone} />
                      )}
                    </div>
                  </div>
                  {list.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">이 세션에는 아직 확정된 전문가가 없습니다.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">코드넘버</TableHead>
                          <TableHead>전문가</TableHead>
                          <TableHead className="w-28 text-right">예정가</TableHead>
                          <TableHead className="w-28">단계</TableHead>
                          <TableHead className="w-28">안내문자</TableHead>
                          <TableHead className="w-44">평가</TableHead>
                          <TableHead className="w-32">등급</TableHead>
                          <TableHead className="w-24">종료</TableHead>
                          <TableHead className="w-64 text-right">수락서 · 긴급 취소</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((r) => {
                          const done = r.completedAt ?? null;
                          const evaluation = r.expertId
                            ? (evaluations[`${r.expertId}:${r.slotId ?? ""}`] ?? null)
                            : null;
                          const tag = r.expertId ? (tagByExpert[r.expertId] ?? null) : null;
                          return (
                            <TableRow key={r.positionId} className={done ? "bg-violet-50 text-violet-950" : "bg-yellow-50"}>
                              <TableCell>
                                <span className="font-mono text-xs">{r.code}</span>
                              </TableCell>
                              <TableCell className="text-sm font-medium">{r.expertName}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {r.fee !== null ? formatKrw(r.fee) : "미정"}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                    STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[r.stage]]
                                  )}
                                >
                                  {ENGAGEMENT_STAGE_LABELS[r.stage]}
                                </span>
                              </TableCell>
                              <TableCell>
                                {/* 안내문자 — 전문가별 (세션 확인 탭에서 이동, 기획 2026-09-21) */}
                                {canNotice && !expertsLite && r.expertId && r.slotId ? (
                                  <SessionNoticeDialog
                                    slotId={r.slotId}
                                    slotLabel={label}
                                    templates={noticeTemplates}
                                    defaultBody={defaultNoticeBody}
                                    targets={noticesBySlot[r.slotId]?.targets ?? []}
                                    notices={noticesBySlot[r.slotId]?.notices ?? []}
                                    singleTarget={{ expertId: r.expertId, name: r.expertName, code: r.code }}
                                    size="xs"
                                  />
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {/* 평가 — 5점 만점·1점 단위 + 의견, 완료 시 종료 처리 (기획 2026-09-21) */}
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  {evaluation && <RatingStars rating={evaluation.rating} />}
                                  {canEvaluate && r.engagementId && r.expertId ? (
                                    <ExpertEvaluateDialog
                                      projectId={projectId}
                                      expertId={r.expertId}
                                      engagementId={r.engagementId}
                                      slotId={r.slotId ?? null}
                                      expertName={r.expertName}
                                      initialRating={evaluation?.rating ?? null}
                                      initialOpinion={evaluation?.opinion ?? null}
                                    />
                                  ) : !evaluation ? (
                                    <span className="text-[11px] text-muted-foreground">-</span>
                                  ) : null}
                                </span>
                              </TableCell>
                              <TableCell>
                                {/* 즐겨찾기 · VIP — 자사 등급, 전문가 본인 비노출 (§4) */}
                                {r.expertId ? (
                                  <span className="inline-flex items-center gap-1">
                                    <ExpertQuickTag
                                      expertId={r.expertId}
                                      expertName={r.expertName}
                                      tag={tag?.tag ?? null}
                                      tagNote={tag?.note ?? null}
                                      target="favorite"
                                      canManage={canEvaluate}
                                    />
                                    <ExpertQuickTag
                                      expertId={r.expertId}
                                      expertName={r.expertName}
                                      tag={tag?.tag ?? null}
                                      tagNote={tag?.note ?? null}
                                      target="vip"
                                      canManage={canEvaluate}
                                    />
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {canManage && r.engagementId ? (
                                  <CompletionButton
                                    kind="engagement"
                                    targetId={r.engagementId}
                                    label={r.expertName}
                                    completedAt={done}
                                    size="xs"
                                  />
                                ) : done ? (
                                  <span className={COMPLETED_BADGE_CLASS}>종료</span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="inline-flex items-center gap-1">
                                  {r.engagementId && !expertsLite && (
                                    <Button asChild size="sm" variant="outline">
                                      <Link href={`/${tenantSlug}/experts/acceptances/${r.engagementId}`}>
                                        <FileCheck2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                                        수락서
                                      </Link>
                                    </Button>
                                  )}
                                  {r.engagementId && (
                                    <EngagementHistoryDialog engagementId={r.engagementId} expertName={r.expertName} />
                                  )}
                                  {canCancel && r.engagementId && (
                                    <EngagementUrgentCancel engagementId={r.engagementId} expertName={r.expertName} />
                                  )}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
