"use client";

import Link from "next/link";
import { ArrowRight, MessageSquare, Building2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { describeSchedule } from "@/lib/sessions/schedule";
import { roleTypeLabel } from "@/lib/integrations/engagement-roles";
import { CANDIDATE_LIST_STATUS_LABELS } from "@/lib/integrations/candidate-list-shared";
import { CLIENT_OPINION_LABELS, type ClientOpinion } from "@/lib/integrations/client-review-shared";
import { composePlanDoc, type AdjustTabData } from "@/lib/integrations/adjust-tab-shared";
import { PROJECT_STAGE_DESCRIPTIONS, PROJECT_STAGE_LABELS, isPrePlanStage, type ProjectStage } from "@/lib/integrations/project-stage";
import type { EngagementStage } from "@/lib/integrations/engagement-stage";
import type { ApproverOption } from "@/components/approvals/approver-picker";

import type { SlotRow } from "./slot-table";
import { CandidateList } from "./candidate-list";
import { EngagementPlanButton, type PlanPreviewLine } from "./engagement-plan-button";

/** 세션 → 계획 상태 (lib/integrations/engagement-plans.ts는 server-only라 라벨을 여기 둔다) */
type SlotPlanState = "none" | "in_progress" | "rejected" | "approved" | "changed";
const SLOT_PLAN_LABELS: Record<SlotPlanState, string> = {
  none: "품의 미포함",
  in_progress: "결재 중",
  rejected: "반려 · 재상신 필요",
  approved: "결재 완료",
  changed: "변경 품의 필요",
};

const OPINION_BADGE: Record<ClientOpinion, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  replace: "bg-rose-100 text-rose-800",
  hold: "bg-amber-100 text-amber-800",
};

/**
 * 섭외후보 조정 탭 (기획 승인 2026-11-07 — 4단계, 03·05·10번).
 *  - 위: 내부 검토 의견 / 발주처 회신 요약. 가운데: 세션별 후보 편집(등록 탭과 같은 부품) + 후보마다 의견 배지.
 *  - 아래: '섭외 품의서 자동 작성 및 송신' — 미리보기(본문·첨부·결재선) → 상신. 품의는 이 탭에서만 올린다.
 *  - 리스트가 없는 프로젝트도 바로 올릴 수 있다(종전 방식). 본문에 그 사실이 적힌다.
 */
export function AdjustTab({
  tenantSlug,
  projectId,
  data,
  slots,
  slotPlanStates,
  stageByPosition,
  projectStage,
  canManage,
  canInput,
  canWithdraw,
  expertsLite,
  planLines,
  approverOptions,
  relayOn,
  flow,
}: {
  tenantSlug: string;
  projectId: string;
  data: AdjustTabData;
  slots: SlotRow[];
  slotPlanStates: Record<string, SlotPlanState> | null;
  stageByPosition: Record<string, EngagementStage>;
  projectStage: ProjectStage;
  /** 실행 축(품의 상신) */
  canManage: boolean;
  /** 입력 축(후보·단가 편집) */
  canInput: boolean;
  canWithdraw: boolean;
  expertsLite: boolean;
  planLines: PlanPreviewLine[];
  approverOptions: ApproverOption[];
  relayOn: boolean;
  flow: { mode: "post_report" } | { mode: "pre_approval"; reason: string | null };
}) {
  const list = data.list;
  const submittableStage = !(["closing", "settlement_review", "settled"] as ProjectStage[]).includes(projectStage);
  const slotState = (slotId: string): SlotPlanState => (slotPlanStates ? slotPlanStates[slotId] ?? "none" : "none");
  const slotInLivePlan = (slotId: string) => {
    const st = slotState(slotId);
    return st === "in_progress" || st === "approved" || st === "changed";
  };
  const lockedSlots: Record<string, string> = {};
  for (const s of slots) if (slotInLivePlan(s.id)) lockedSlots[s.id] = SLOT_PLAN_LABELS[slotState(s.id)];
  const submittableCount = slots.filter((s) => !slotInLivePlan(s.id)).length;
  const entryName = list ? new Map(list.entries.map((e) => [e.id, `${e.expertName}(${e.code})`])) : new Map<string, string>();

  const planButton = canManage && submittableStage && (
    <EngagementPlanButton
      projectId={projectId}
      disabled={slots.length === 0 || submittableCount === 0}
      disabledReason={
        slots.length === 0
          ? "세션(코드넘버)을 먼저 등록하세요."
          : "모든 세션이 결재 중이거나 승인되었습니다. 세션을 추가하면 별도 품의로 올릴 수 있습니다."
      }
      lines={planLines}
      lockedSlots={lockedSlots}
      approverOptions={approverOptions}
      relayOn={relayOn}
      flow={flow}
      candidateList={{
        listId: list?.id ?? null,
        compose: (slotIds) => composePlanDoc(data, slotIds.length > 0 ? slotIds : null),
      }}
    />
  );

  return (
    <div className="space-y-5">
      {/* 머리 — 상태·안내·품의 버튼 */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">섭외후보 조정</CardTitle>
            {list ? (
              <Badge className="bg-violet-600 hover:bg-violet-600">{list.title} · {CANDIDATE_LIST_STATUS_LABELS[list.status] ?? list.status}</Badge>
            ) : (
              <Badge variant="outline">후보 리스트 없음 — 바로 품의</Badge>
            )}
            <span className="text-xs text-muted-foreground">프로젝트 단계: {PROJECT_STAGE_LABELS[projectStage]}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {planButton}
            {!isPrePlanStage(projectStage) && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${tenantSlug}/projects/${projectId}?tab=engage`}>
                  승인 목록 및 섭외 진행 <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>{PROJECT_STAGE_DESCRIPTIONS[projectStage]}</p>
          <p>
            내부 검토 의견과 발주처 회신을 보면서 후보·순위·단가를 고치는 자리입니다. 고친 뒤 <b>섭외 품의서 자동 작성 및 송신</b>을 누르면
            본문(세션별 후보·자격메모·내부 의견·발주처 회신 요약)과 첨부(발주처 회신 원문·내부 검토 의견)가 자동으로 만들어져 미리보기 후 결재선으로 갑니다.
            결재권자는 결재 화면에서 순위·제외·단가를 직접 조정할 수 있고, 승인되면 ‘승인 목록 및 섭외 진행’ 탭으로 이어집니다.
          </p>
          {!list && data.ready && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              이 프로젝트는 아직 <b>리스트 작성 → 발주처 검토</b>를 거치지 않았습니다. 그대로 품의할 수 있지만(본문에 그 사실이 적힙니다), 검토 의견을 받으려면{" "}
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=list`} className="font-semibold underline underline-offset-4">리스트 작성</Link> 탭에서 내부 검토를 먼저 요청하세요.
            </p>
          )}
          {list && list.status === "submitted" && (
            <p className="rounded-md border border-violet-200 bg-violet-50 p-2 text-violet-900">
              이 리스트로 품의가 이미 상신되었습니다. 반려·추가 세션으로 다시 올리면 같은 내부 의견·발주처 회신이 첨부됩니다. 새로 검토를 받으려면{" "}
              <Link href={`/${tenantSlug}/projects/${projectId}?tab=list`} className="font-semibold underline underline-offset-4">리스트 작성</Link> 탭에서 새 리스트를 요청하세요.
            </p>
          )}
          {list && list.status !== "adjusting" && list.status !== "submitted" && (
            <p className="rounded-md border border-cyan-200 bg-cyan-50 p-2 text-cyan-900">
              리스트가 아직 ‘{CANDIDATE_LIST_STATUS_LABELS[list.status] ?? list.status}’ 상태입니다. 검토가 끝나기 전에 품의를 올리면 그때까지의 의견만 첨부됩니다.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 의견 요약 — 내부 / 발주처 */}
      {list && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm"><MessageSquare className="h-4 w-4" aria-hidden /> 내부 검토 의견</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {list.reviews.map((r) => (
                  <span key={r.id} className={cn("rounded-full border px-2 py-0.5", r.status === "done" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800")}>
                    {r.reviewerName} · {r.status === "done" ? "완료" : "미응답"}
                  </span>
                ))}
                {list.reviews.length === 0 && <span className="text-muted-foreground">검토자 없음</span>}
              </div>
              {data.generalComments.length === 0 ? (
                <p className="text-muted-foreground">리스트 전체 의견 없음. 후보별 의견은 아래 각 후보 옆에 표시됩니다.</p>
              ) : (
                <ul className="space-y-1">
                  {data.generalComments.map((c, i) => (
                    <li key={i} className="rounded bg-amber-50 px-2 py-1"><span className="font-semibold text-amber-900">{c.authorName}</span> <span className="whitespace-pre-wrap">{c.body}</span></li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">후보별 의견 {list.comments.filter((c) => c.entryId !== null).length}건 — 아래 후보 행에 표시 · 품의서에 전문 첨부</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm"><Building2 className="h-4 w-4" aria-hidden /> 발주처 회신 {data.responses.length > 0 ? `(${data.responses.length}건)` : ""}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {data.responses.length === 0 && (
                <p className="text-muted-foreground">
                  발주처 회신이 없습니다 (건너뛰었거나 미회신). 필요하면{" "}
                  <Link href={`/${tenantSlug}/projects/${projectId}?tab=client`} className="text-brand underline underline-offset-4">발주처 검토</Link> 탭에서 링크를 만드세요.
                </p>
              )}
              {data.responses.map((r) => {
                const counts = { ok: 0, replace: 0, hold: 0 };
                for (const it of r.items) counts[it.opinion] += 1;
                return (
                  <div key={r.id} className="space-y-1 rounded-md border p-2">
                    <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <Badge variant="secondary">{r.round}라운드</Badge>
                      <span>{fmt(r.submittedAt)}</span>
                      {r.respondentName && <span>· {r.respondentName}</span>}
                      <span className="ml-auto">적합 {counts.ok} · 교체 {counts.replace} · 보류 {counts.hold}</span>
                    </p>
                    {r.generalComment && <p className="whitespace-pre-wrap rounded bg-secondary/60 px-2 py-1"><b>전체 요청사항</b> — {r.generalComment}</p>}
                    {r.items.filter((it) => it.opinion !== "ok").map((it) => (
                      <p key={it.entryId} className="flex flex-wrap items-start gap-1.5">
                        <span className={cn("rounded px-1.5 py-0.5 font-semibold", OPINION_BADGE[it.opinion])}>{CLIENT_OPINION_LABELS[it.opinion]}</span>
                        <span className="font-medium">{entryName.get(it.entryId) ?? "후보"}</span>
                        {it.comment && <span className="text-muted-foreground">{it.comment}</span>}
                      </p>
                    ))}
                  </div>
                );
              })}
              {data.removed.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  리스트에 있었지만 지금 자리에서 빠진 후보: {data.removed.map((x) => `${x.expertName}(${x.code})`).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 세션별 후보 편집 + 의견 배지 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">세션별 후보 조정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {slots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              세션이 없습니다. <Link href={`/${tenantSlug}/projects/${projectId}?tab=basic`} className="text-brand underline underline-offset-4">기본설정</Link> 탭에서 세션을 등록하세요.
            </p>
          )}
          {slots.map((slot) => {
            const st = slotState(slot.id);
            const locked = st === "in_progress";
            const slotEditable = canInput && submittableStage && !locked;
            const annotated = slot.positions
              .filter((p) => p.status !== "canceled" && (p.expertId || p.assignedExpertId))
              .flatMap((p) => {
                const a = data.annotations[p.id];
                if (!a) return [];
                if (a.internalComments.length === 0 && a.clientOpinions.length === 0 && !(a.isNew && list)) return [];
                return [{ p, a }];
              });
            return (
              <section key={slot.id} id={`slot-${slot.id}`} className="rounded-lg border p-3 scroll-mt-24">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">{slot.sessionName ?? roleTypeLabel(slot.roleType) ?? slot.roleType}</span>
                  <span className="text-xs text-muted-foreground">{describeSchedule(slot.schedule, { withYear: true, formal: true })}</span>
                  <span className="text-xs text-muted-foreground">필요인원 {slot.requiredCount}명</span>
                  {slotPlanStates && (
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", st === "approved" ? "bg-emerald-100 text-emerald-900" : st === "in_progress" ? "bg-amber-100 text-amber-900" : st === "changed" ? "bg-rose-100 text-rose-900" : st === "rejected" ? "bg-red-100 text-red-900" : "bg-violet-100 text-violet-900")}>
                      {SLOT_PLAN_LABELS[st]}{slotEditable ? " · 편집 가능" : ""}
                    </span>
                  )}
                </div>
                {annotated.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-md bg-secondary/40 p-2 text-xs">
                    {annotated.map(({ p, a }) => (
                      <li key={p.id} className="flex flex-wrap items-start gap-1.5">
                        <span className="font-mono font-semibold">{p.code}</span>
                        <span className="font-medium">{p.assignedExpertName ?? p.expertName}</span>
                        {a.isNew && list && <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800"><Sparkles className="h-3 w-3" aria-hidden /> 검토 후 새 후보</span>}
                        {a.clientOpinions.map((o, i) => (
                          <span key={`c${i}`} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", OPINION_BADGE[o.opinion])} title={o.comment ?? undefined}>
                            발주처 {o.round}R {CLIENT_OPINION_LABELS[o.opinion]}{o.comment ? ` · ${o.comment}` : ""}
                          </span>
                        ))}
                        {a.internalComments.map((c, i) => (
                          <span key={`i${i}`} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                            {c.authorName}: {c.body}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">
                  <CandidateList
                    tenantSlug={tenantSlug}
                    projectId={projectId}
                    slotId={slot.id}
                    requiredCount={slot.requiredCount}
                    positions={slot.positions}
                    stageByPosition={stageByPosition}
                    canManage={canInput}
                    canWithdraw={canWithdraw}
                    canExecute={canManage}
                    expertsLite={expertsLite}
                    editable={slotEditable}
                    schedule={slot.schedule}
                    slotUnitOnline={slot.unitFeeOnline}
                    slotUnitOffline={slot.unitFeeOffline}
                    slotHourlyOnline={slot.hourlyFeeOnline}
                    slotHourlyOffline={slot.hourlyFeeOffline}
                  />
                </div>
              </section>
            );
          })}
          {/* 하단 — 품의 (상단과 같은 버튼: 긴 목록을 내려온 뒤 다시 올라가지 않게) */}
          {canManage && submittableStage && slots.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                후보 조정을 마쳤으면 품의서를 자동 작성해 상신하세요. 세션을 골라 올릴 수 있고, 결재 중인 세션은 잠깁니다.
              </p>
              {planButton}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}
