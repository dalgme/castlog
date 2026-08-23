"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKrw } from "@/lib/approvals/constants";
import { Input } from "@/components/ui/input";
import { commaInputHandler, formatComma } from "@/components/ui/comma-number-input";
import { useToast } from "@/hooks/use-toast";

import {
  reviewerRemoveCandidate,
  reviewerReorderCandidates,
  reviewerSetCandidateFee,
} from "./plan-review-actions";

export type ReviewCandidate = {
  id: string;
  code: string;
  expertName: string | null;
  expectedFee: number | null;
  editable: boolean; // 섭외 미진행(open/assigned)만 삭제 가능
};

export type ReviewSlot = {
  slotId: string;
  label: string; // 세션명 · 일정
  requiredCount: number;
  candidates: ReviewCandidate[]; // 순위순
};

/**
 * 결재권자용 섭외계획 편집 패널 (기획 확정 2026-08-22)
 * 지금 결재 차례인 결재권자가 순위 변경(드래그)·후보 삭제·예정가 수정을 한다.
 * 모든 변경은 결재권자별 변경 내역으로 기록되어 담당자가 본다.
 */
export function PlanReviewPanel({
  approvalId,
  slots,
  canEdit,
}: {
  approvalId: string;
  slots: ReviewSlot[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, string[]>>(
    Object.fromEntries(
      slots.map((s) => [s.slotId, s.candidates.map((c) => c.id)])
    )
  );

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    doneMsg: string
  ) => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        toast({ description: doneMsg });
        router.refresh();
      }
    });
  };

  function onDrop(slot: ReviewSlot, targetId: string) {
    if (!dragId || dragId === targetId) return;
    const current = orders[slot.slotId] ?? slot.candidates.map((c) => c.id);
    const next = [...current];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrders((prev) => ({ ...prev, [slot.slotId]: next }));
    setDragId(null);
    run(
      () => reviewerReorderCandidates(approvalId, slot.slotId, next),
      "순위 변경이 기록·저장되었습니다."
    );
  }

  return (
    <div className="space-y-3">
      {slots.map((slot) => {
        const byId = new Map(slot.candidates.map((c) => [c.id, c]));
        const ordered = (orders[slot.slotId] ?? slot.candidates.map((c) => c.id))
          .map((id) => byId.get(id))
          .filter((c): c is ReviewCandidate => Boolean(c));
        return (
          <div key={slot.slotId} className="rounded-md border bg-background p-3">
            <p className="mb-1.5 text-sm font-semibold">
              {slot.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                필요 {slot.requiredCount}명 · 후보 {ordered.length}명
              </span>
            </p>
            <ul className="divide-y">
              {ordered.map((c, idx) => {
                const isTarget = idx < slot.requiredCount;
                return (
                  <li
                    key={c.id}
                    draggable={canEdit}
                    onDragStart={() => setDragId(c.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(slot, c.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      "flex flex-wrap items-center gap-2 py-1.5 text-sm",
                      dragId === c.id && "opacity-50"
                    )}
                  >
                    {canEdit && (
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
                    >
                      {idx + 1}순위{isTarget ? " ★" : ""}
                    </span>
                    <span className="font-mono text-xs">{c.code}</span>
                    <span className="font-medium">
                      {c.expertName ?? "(미배정)"}
                    </span>
                    {canEdit ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Input
                          inputMode="numeric"
                          defaultValue={formatComma(c.expectedFee)}
                          onInput={commaInputHandler}
                          placeholder="예정가(원)"
                          className="h-7 w-28 text-xs tabular-nums"
                          onBlur={(e) => {
                            const v = e.target.value.replace(/\D/g, "");
                            if (v !== String(c.expectedFee ?? "")) {
                              run(
                                () =>
                                  reviewerSetCandidateFee(approvalId, c.id, v),
                                "예정가 변경이 기록·저장되었습니다."
                              );
                            }
                          }}
                        />
                        원
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {c.expectedFee !== null
                          ? formatKrw(c.expectedFee)
                          : "예정가 미정"}
                      </span>
                    )}
                    {canEdit && c.editable && (
                      <button
                        type="button"
                        aria-label="후보 삭제"
                        disabled={pending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `${c.expertName ?? c.code} 후보를 계획에서 제외할까요?\n변경 내역에 기록됩니다.`
                            )
                          ) {
                            run(
                              () => reviewerRemoveCandidate(approvalId, c.id),
                              "후보 제외가 기록·저장되었습니다."
                            );
                          }
                        }}
                        className="ml-auto rounded p-1 text-muted-foreground hover:text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {canEdit && (
        <p className="text-[11px] text-muted-foreground">
          드래그로 순위를 바꾸고, 예정가를 수정하거나 후보를 제외할 수 있습니다.
          모든 변경은 아래 ‘결재권자 변경 내역’에 본인 이름으로 기록되어
          담당자에게 보입니다.
        </p>
      )}
    </div>
  );
}
