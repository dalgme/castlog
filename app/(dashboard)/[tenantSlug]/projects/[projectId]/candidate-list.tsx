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
import { EngagementUrgentCancel } from "@/components/integrations/engagement-urgent-cancel";
import { EngagementHistoryDialog } from "./engagement-history-dialog";
import { ManualAcceptButton } from "./manual-accept-button";
import { PositionRequestDialog } from "./position-request-dialog";
import type { SlotPositionRow } from "./slot-table";
import {
  addCandidate,
  removeCandidate,
  reorderCandidates,
  setCandidateFee,
} from "./slot-actions";

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
  canCancel,
  canWithdraw,
  canExecute,
  expertsLite = false,
  sessionDuration,
  editable,
}: {
  tenantSlug: string;
  projectId: string;
  slotId: string;
  requiredCount: number;
  positions: SlotPositionRow[];
  stageByPosition: Record<string, EngagementStage>;
  canManage: boolean;
  /** 확정 후 긴급 취소 버튼 — 레벨 3부터 (입력 권한과 별개 축) */
  canCancel: boolean;
  /** 응답 전 회수 버튼 — 레벨 4부터 (권한 축 분리, 기획 확정 2026-08-29) */
  canWithdraw: boolean;
  /** 실행 축(섭외요청 등, 레벨 4부터) — 전화 섭외 수동 완료 버튼 */
  canExecute: boolean;
  /** 라이트 모드 — 수동 완료 시 '수락서 확인까지 한 번에' 옵션 노출 */
  expertsLite?: boolean;
  /** 세션 진행 시간 (예: "3시간") — 예정가 옆 참고 표시 */
  sessionDuration?: string | null;
  /** 순위·예정가·후보 편집 가능 여부 — 품의 상신 전(assigning)만 */
  editable: boolean;
}) {
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

              {/* 후보별 예정가 — 결재·정산 금액의 근거. 전문가를 올려야
                  금액 칸이 활성화된다 (기획 2026-08-30 — 빈 자리에 금액부터
                  적는 역순 입력 방지). 결재권자는 품의 결재 화면에서 수정 가능 */}
              {editable &&
              canManage &&
              (p.expertName ?? p.assignedExpertName) === null ? (
                <span
                  className="text-xs text-muted-foreground/70"
                  title="후보 전문가를 먼저 배정하면 예정가를 입력할 수 있습니다"
                >
                  예정가 — 후보 배정 후 입력
                </span>
              ) : editable && canManage ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  <Input
                    inputMode="numeric"
                    defaultValue={formatComma(p.expectedFee)}
                    onInput={commaInputHandler}
                    placeholder="예정가(원)"
                    className="h-7 w-28 text-xs tabular-nums"
                    onBlur={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      if (v !== String(p.expectedFee ?? "")) {
                        run(() => setCandidateFee(p.id, v));
                      }
                    }}
                  />
                  원
                  {sessionDuration && (
                    <span className="text-muted-foreground">
                      · {sessionDuration}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {p.expectedFee !== null
                    ? `예정가 ${formatKrw(p.expectedFee)}`
                    : "예정가 미정"}
                  {sessionDuration ? ` · ${sessionDuration}` : ""}
                </span>
              )}

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
                {canCancel &&
                  p.engagementId &&
                  isFilled &&
                  stage !== "canceled" && (
                    <EngagementUrgentCancel
                      engagementId={p.engagementId}
                      expertName={p.expertName ?? "전문가"}
                    />
                  )}
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
