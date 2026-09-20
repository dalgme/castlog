"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, GripVertical, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKrw } from "@/lib/approvals/constants";
import {
  ENGAGEMENT_STAGE_DESCRIPTIONS,
  ENGAGEMENT_STAGE_LABELS,
  ENGAGEMENT_STAGE_TONE,
  STAGE_TONE_CLASS,
  type EngagementStage,
} from "@/lib/integrations/engagement-stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commaInputHandler, formatComma } from "@/components/ui/comma-number-input";
import { useToast } from "@/hooks/use-toast";

import { EngagementCancelButton } from "@/components/integrations/engagement-cancel-button";
import { EngagementHistoryDialog } from "./engagement-history-dialog";
import { ManualAcceptButton } from "./manual-accept-button";
import { PositionRequestDialog } from "./position-request-dialog";
import type { SlotPositionRow } from "./slot-table";
import {
  addCandidate,
  removeCandidate,
  reorderCandidates,
  setCandidateFee,
  setCandidateUnitFees,
} from "./slot-actions";
import { countLabel, fmtHours, hybridCountLabel, type SessionSchedule } from "@/lib/sessions/schedule";
import { computeFeeTotal, formatFeeTotal, formatWon } from "@/lib/sessions/fees";
import { hourlyFromStored, unitFeeFields } from "@/components/sessions/unit-fee-form";

/**
 * 세션별 섭외 후보 목록 (기획 확정 2026-08-22 — 후보 순위 모델)
 *
 * - 임시후보 코드마다 전문가 배정 + **개별 예정가** 입력
 * - **드래그로 섭외 순위** 조정 (숫자 직접 입력 없음)
 * - 순위 상위 '필요인원'명이 섭외 대상(★), 나머지는 예비 후보
 * - 후보 추가/삭제 (섭외가 진행된 후보는 삭제 불가)
 */
export function CandidateList({
  tenantSlug,
  projectId,
  slotId,
  requiredCount,
  positions,
  stageByPosition,
  canManage,
  canWithdraw,
  canExecute,
  expertsLite = false,
  editable,
  schedule,
  slotUnitOnline,
  slotUnitOffline,
  slotHourlyOnline,
  slotHourlyOffline,
}: {
  tenantSlug: string;
  projectId: string;
  slotId: string;
  requiredCount: number;
  positions: SlotPositionRow[];
  stageByPosition: Record<string, EngagementStage>;
  canManage: boolean;
  /** 응답 전 회수 버튼 — 레벨 4부터 (권한 축 분리, 기획 확정 2026-08-29) */
  canWithdraw: boolean;
  /** 실행 축(섭외요청 등, 레벨 4부터) — 전화 섭외 수동 완료 버튼 */
  canExecute: boolean;
  /** 라이트 모드 — 수동 완료 시 '수락서 확인까지 한 번에' 옵션 노출 */
  expertsLite?: boolean;
  /** 순위·예정가·후보 편집 가능 여부 — 품의 상신 전(assigning)만 */
  editable: boolean;
  /** 회차·진행 방식 — 총액 = 회차 × 회당 단가 (기획 2026-09-21) */
  schedule: SessionSchedule;
  /** 세션 일괄 단가 — 이와 다르면 '개별 수정'(코랄) */
  slotUnitOnline: number | null;
  slotUnitOffline: number | null;
  /** 세션 일괄 시간당 비용 (입력값) */
  slotHourlyOnline: number | null;
  slotHourlyOffline: number | null;
}) {
  const feeFields = unitFeeFields(schedule.deliveryMode);
  const countText = hybridCountLabel(schedule) ?? countLabel(schedule);
  const hours = schedule.hoursPerSession;
  const hoursText = hours ? `${fmtHours(hours)}시간` : "1시간(미입력)";
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<string[]>(positions.map((p) => p.id));
  const [dragId, setDragId] = useState<string | null>(null);

  // 서버 데이터가 갱신되면(새 후보 추가 등) 로컬 순서를 다시 맞춘다
  const serverIds = positions.map((p) => p.id).join(",");
  const [syncedIds, setSyncedIds] = useState(serverIds);
  if (serverIds !== syncedIds) {
    setSyncedIds(serverIds);
    setOrder(positions.map((p) => p.id));
  }

  const byId = new Map(positions.map((p) => [p.id, p]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((p): p is SlotPositionRow => Boolean(p));

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    doneMsg?: string
  ) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        if (doneMsg) toast({ description: doneMsg });
        router.refresh();
      }
    });
  };

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrder(next);
    setDragId(null);
    run(() => reorderCandidates(slotId, next), "섭외 순위가 저장되었습니다.");
  }

  return (
    <div className="mt-2">
      <ul className="divide-y">
        {ordered.map((p, idx) => {
          const isOpen = p.status === "open" || p.status === "assigned";
          const isFilled = p.status === "filled";
          const stage = stageByPosition[p.id] ?? "assigned";
          const isTarget = idx < requiredCount;
          return (
            <li
              key={p.id}
              draggable={editable && canManage}
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.id)}
              onDragEnd={() => setDragId(null)}
              className={cn(
                "flex flex-wrap items-center gap-2 py-2 text-sm",
                dragId === p.id && "opacity-50",
                p.canceledExpertName !== null &&
                  "-mx-2 rounded-md border-l-4 border-amber-500 bg-amber-50 px-2"
              )}
            >
              {editable && canManage && (
                <GripVertical
                  className="h-4 w-4 cursor-grab text-muted-foreground"
                  aria-label="드래그하여 순위 변경"
                />
              )}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  isTarget
                    ? "bg-brand text-white"
                    : "bg-secondary text-muted-foreground"
                )}
                title={
                  isTarget
                    ? "섭외 대상 (순위 상위 필요인원)"
                    : "예비 후보 — 상위 후보가 거절하면 순번이 올라갑니다"
                }
              >
                {idx + 1}순위{isTarget ? " ★" : ""}
              </span>
              <span
                className="font-mono text-xs font-semibold"
                title="코드넘버"
              >
                {p.code}
              </span>
              {p.canceledExpertName !== null && (
                <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-bold text-destructive">
                  긴급취소 · {p.canceledExpertName}
                </span>
              )}
              {/* 거절·만료로 비게 된 자리 — '결재 완료' 배지만 남기면 거절이
                  없었던 것처럼 보인다 (E2E 검수 P2-8) */}
              {p.priorOutcome && (
                <span
                  title="이 자리에 요청했던 전문가의 최근 회신 결과 — 예비 후보에게 개별 요청하세요"
                  className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900"
                >
                  {p.priorOutcome.outcome === "declined" ? "거절" : "요청 만료"} ·{" "}
                  {p.priorOutcome.expertName}
                </span>
              )}
              <span
                className={
                  p.expertName ?? p.assignedExpertName
                    ? "font-medium"
                    : "text-muted-foreground"
                }
              >
                {p.expertName ?? p.assignedExpertName ?? "미배정"}
              </span>
              <span
                title={ENGAGEMENT_STAGE_DESCRIPTIONS[stage]}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  STAGE_TONE_CLASS[ENGAGEMENT_STAGE_TONE[stage]]
                )}
              >
                {ENGAGEMENT_STAGE_LABELS[stage]}
              </span>

              {/* 회당 단가 → 총액 (기획 2026-09-21). 전문가를 올려야 금액 칸이
                  활성화된다 (기획 2026-08-30 — 역순 입력 방지). 일괄 단가와 다르면
                  코랄로 표시되어 상신자·결재자가 알아본다 */}
              {(() => {
                const total =
                  p.feeCustom && p.unitFeeOnline === null && p.unitFeeOffline === null && p.expectedFee !== null
                    ? { min: p.expectedFee, max: p.expectedFeeMax ?? p.expectedFee, note: null }
                    : computeFeeTotal(
                        schedule,
                        p.unitFeeOnline ?? slotUnitOnline,
                        p.unitFeeOffline ?? slotUnitOffline
                      );
                const totalText = total ? formatFeeTotal(total) : p.expectedFee !== null ? formatKrw(p.expectedFee) : null;
                const customCls = p.feeCustom ? "text-coral font-semibold" : "";
                const unassigned = (p.expertName ?? p.assignedExpertName) === null;
                if (editable && canManage && unassigned) {
                  return p.expectedFee !== null ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      총액 {totalText} (미배정 잔존)
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => setCandidateFee(p.id, ""), "금액을 비웠습니다.")}
                        className="underline underline-offset-2 hover:text-red-600"
                      >
                        비우기
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70" title="후보 전문가를 먼저 배정하면 단가를 입력할 수 있습니다">
                      단가 — 후보 배정 후 입력 (세션 일괄등록 시 자동 반영)
                    </span>
                  );
                }
                if (editable && canManage) {
                  // 입력은 시간당 비용, 회당 단가 = 시간당 × 회차당 시간, 총액 = 회당 × 회차 (기획 지시 2026-09-21)
                  const hourlyOf = (key: "online" | "offline") =>
                    hourlyFromStored(
                      key === "online" ? p.hourlyFeeOnline : p.hourlyFeeOffline,
                      key === "online" ? p.unitFeeOnline : p.unitFeeOffline,
                      hours
                    );
                  const slotHourlyOf = (key: "online" | "offline") =>
                    hourlyFromStored(
                      key === "online" ? slotHourlyOnline : slotHourlyOffline,
                      key === "online" ? slotUnitOnline : slotUnitOffline,
                      hours
                    );
                  return (
                    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
                      {feeFields.map((f) => {
                        const unit = f.key === "online" ? p.unitFeeOnline ?? slotUnitOnline : p.unitFeeOffline ?? slotUnitOffline;
                        return (
                          <label key={f.key} className="inline-flex items-center gap-1">
                            <span className="text-muted-foreground">
                              {f.label.replace(" 시간당 비용", "").replace("시간당 비용", "").trim() || "시간당"}
                            </span>
                            <Input
                              inputMode="numeric"
                              defaultValue={formatComma(hourlyOf(f.key))}
                              onInput={commaInputHandler}
                              placeholder={formatComma(slotHourlyOf(f.key)) || "시간당(원)"}
                              title={`시간당 비용 — 회차당 ${hoursText}을 곱해 회당 단가가 됩니다`}
                              className={cn("h-7 w-24 text-xs tabular-nums", p.feeCustom && "border-coral text-coral")}
                              onBlur={(e) => {
                                const v = e.target.value.replace(/\D/g, "");
                                const cur = hourlyOf(f.key);
                                if (v !== String(cur ?? "")) {
                                  const other = hourlyOf(f.key === "online" ? "offline" : "online");
                                  run(() =>
                                    setCandidateUnitFees(p.id, {
                                      hourlyOnline: f.key === "online" ? v : String(other ?? ""),
                                      hourlyOffline: f.key === "offline" ? v : String(other ?? ""),
                                    })
                                  );
                                }
                              }}
                            />
                            {unit !== null && <span className="text-muted-foreground">→ 회당 {formatWon(unit)}</span>}
                          </label>
                        );
                      })}
                      <span className={cn("text-muted-foreground", customCls)} title={total?.note ?? undefined}>
                        {countText ? `× ${countText} = ` : ""}
                        {totalText ? `총액 ${totalText}` : "총액 —"}
                        {p.feeCustom && " (개별 수정)"}
                      </span>
                    </span>
                  );
                }
                return (
                  <span className={cn("text-xs text-muted-foreground", customCls)} title={total?.note ?? undefined}>
                    {totalText ? `총액 ${totalText}` : "금액 미정"}
                    {countText ? ` · ${countText}` : ""}
                    {p.feeCustom && " (개별 수정)"}
                  </span>
                );
              })()}

              <span className="ml-auto flex items-center gap-1.5">
                {isOpen && canManage && (
                  <>
                    <PositionRequestDialog
                      positionId={p.id}
                      code={p.code}
                      currentExpertName={p.assignedExpertName}
                    />
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                      >
                        자세히
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </>
                )}
                {isOpen && !canManage && (
                  <span className="text-xs text-muted-foreground">
                    탐색·배정 권한이 없습니다 (권한 규칙 — 기본 레벨 5, 회사
                    조정 가능)
                  </span>
                )}
                {!isOpen && (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/${tenantSlug}/projects/${projectId}/positions/${p.id}`}
                    >
                      상세 요청사항
                    </Link>
                  </Button>
                )}
                {isFilled && p.engagementId && (
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      href={`/${tenantSlug}/experts/acceptances/${p.engagementId}`}
                    >
                      수락서
                    </Link>
                  </Button>
                )}
                {/* 전화 등으로 수락을 직접 확인한 경우 — 수동 섭외 완료 (기획 확정 2026-08-23) */}
                {canExecute && p.engagementId && stage === "requested" && (
                  <ManualAcceptButton
                    engagementId={p.engagementId}
                    expertName={p.expertName ?? p.assignedExpertName}
                    expertsLite={expertsLite}
                  />
                )}
                {canWithdraw && p.engagementId && stage === "requested" && (
                  <EngagementCancelButton engagementId={p.engagementId} />
                )}
                {/* 취소 권한 없는 담당자에게 경로를 말해 준다 — 버튼만 사라지면
                    잘못 보낸 요청을 어떻게 거두는지 알 수 없다 (검수 F3) */}
                {!canWithdraw && p.engagementId && stage === "requested" && (
                  <span className="text-[11px] text-muted-foreground">
                    회수 권한 없음 (권한 규칙 — 기본 레벨 4)
                  </span>
                )}
                {/* 확정 후 긴급 취소는 '승인 목록 및 섭외 진행' 탭에서 한다
                    (기획 지시 2026-09-05) — 여기서는 요청 전 후보만 삭제한다 */}
                {/* 섭외 이력 — 대상자별 발송·동의·수동 처리 타임라인 */}
                {p.engagementId && (
                  <EngagementHistoryDialog
                    engagementId={p.engagementId}
                    expertName={p.expertName ?? p.assignedExpertName}
                  />
                )}
                {editable && canManage && isOpen && !p.engagementId && (
                  <button
                    type="button"
                    aria-label="후보 삭제"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`코드넘버 ${p.code} 후보를 삭제할까요?`)) {
                        run(() => removeCandidate(p.id), "후보가 삭제되었습니다.");
                      }
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {editable && canManage && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => addCandidate(slotId), "후보 자리(코드넘버)가 추가되었습니다.")}
        >
          <Plus className="mr-1 h-4 w-4" />
          후보 추가
        </Button>
      )}
    </div>
  );
}
