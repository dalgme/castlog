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
  /** 총액 최대 (회차·병행 범위) — 기획 2026-09-21 */
  expectedFeeMax?: number | null;
  /** 일괄 단가에서 개별 수정한 금액 — 코랄 표시 */
  feeCustom?: boolean;
  editable: boolean; // 섭외 미진행(open/assigned)만 삭제 가능
};

function feeText(c: ReviewCandidate): string {
  if (c.expectedFee === null) return "예정가 미정";
  const max = c.expectedFeeMax ?? null;
  return max !== null && max !== c.expectedFee ? `${formatKrw(c.expectedFee)} ~ ${formatKrw(max)}` : formatKrw(c.expectedFee);
}

/** 결재권자가 세션 화면을 열지 않고도 판단할 수 있게 — 진행일자·시간·시수·세부역할·장소·비고 */
export type ReviewSlotDetail = {
  date: string;
  periodEnd: string | null;
  startsTime: string | null;
  endsTime: string | null;
  /** 날짜 유형별 일정 줄 (개별선택형은 날짜마다 한 줄) — 있으면 진행일자·시간 대신 쓴다 */
  scheduleText?: string | null;
  countText?: string | null;
  deliveryText?: string | null;
  roleDescription: string | null;
  fieldName: string | null;
  locationName: string | null;
  notes: string | null;
};

export type ReviewSlot = {
  slotId: string;
  /** 승인 뒤 세션 내용이 바뀜 — 붉은 굵은 테두리 (기획 2026-09-21) */
  changed?: boolean;
  label: string; // 세션명 · 일정
  requiredCount: number;
  detail?: ReviewSlotDetail;
  candidates: ReviewCandidate[]; // 순위순
};

/** 시작·종료 시각에서 시수 — "2.5시간". 자정을 넘기면 다음 날로 본다 */
function hoursBetween(starts: string | null, ends: string | null): string | null {
  if (!starts || !ends) return null;
  const toMinutes = (t: string): number | null => {
    const [h, m] = t.split(":").map(Number);
    return h !== undefined && m !== undefined && Number.isFinite(h) && Number.isFinite(m)
      ? h * 60 + m
      : null;
  };
  const start = toMinutes(starts);
  const end = toMinutes(ends);
  if (start === null || end === null) return null;
  let minutes = end - start;
  if (minutes < 0) minutes += 24 * 60;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}시간`;
}

function SlotDetail({ d }: { d: ReviewSlotDetail }) {
  const time =
    d.startsTime && d.endsTime
      ? `${d.startsTime.slice(0, 5)}~${d.endsTime.slice(0, 5)}`
      : d.startsTime
        ? d.startsTime.slice(0, 5)
        : null;
  const hours = hoursBetween(d.startsTime, d.endsTime);
  const rows: [string, string | null][] = d.scheduleText
    ? [
        ["진행일정", d.scheduleText],
        ["회차·방식", [d.countText, d.deliveryText].filter(Boolean).join(" · ") || null],
        ["시수", hours],
        ["세부역할", [d.fieldName, d.roleDescription].filter(Boolean).join(" · ") || null],
        ["장소", d.locationName],
        ["비고", d.notes],
      ]
    : [
        ["진행일자", d.periodEnd && d.periodEnd !== d.date ? `${d.date} ~ ${d.periodEnd}` : d.date],
        ["시간", time],
        ["시수", hours],
        ["세부역할", [d.fieldName, d.roleDescription].filter(Boolean).join(" · ") || null],
        ["장소", d.locationName],
        ["비고", d.notes],
      ];
  return (
    <dl className="mb-2 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 rounded-md bg-secondary/40 px-2.5 py-2 text-xs sm:grid-cols-[4.5rem_1fr_4.5rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={cn("whitespace-pre-wrap break-words", !value && "text-muted-foreground")}>
            {value || "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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

  // 위/아래 이동 — 드래그는 터치 기기에서 동작하지 않는다. 결재 승인·조정은
  // 모바일 완전 대응 대상이라 버튼 경로를 함께 둔다 (검수 G2 · §10)
  function moveBy(slot: ReviewSlot, id: string, delta: -1 | 1) {
    const current = orders[slot.slotId] ?? slot.candidates.map((c) => c.id);
    const from = current.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setOrders((prev) => ({ ...prev, [slot.slotId]: next }));
    run(
      () => reviewerReorderCandidates(approvalId, slot.slotId, next),
      "순위 변경이 기록·저장되었습니다."
    );
  }

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
          <div
            key={slot.slotId}
            className={
              slot.changed
                ? "rounded-md border-[3px] border-red-600 bg-background p-3"
                : "rounded-md border bg-background p-3"
            }
            title={slot.changed ? "결재 승인 후 세션 내용이 변경됨 — 변경 품의(재승인) 필요" : undefined}
          >
            <p className="mb-1.5 text-sm font-semibold">
              {slot.label}
              {slot.changed && (
                <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  승인 후 변경 · 재승인 필요
                </span>
              )}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                필요 {slot.requiredCount}명 · 후보 {ordered.length}명
              </span>
            </p>
            {slot.detail && <SlotDetail d={slot.detail} />}
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
                      <span className="flex items-center gap-0.5">
                        <GripVertical
                          className="h-4 w-4 cursor-grab text-muted-foreground"
                          aria-label="드래그하여 순위 변경"
                        />
                        <button
                          type="button"
                          aria-label="한 칸 위로"
                          disabled={pending || idx === 0}
                          onClick={() => moveBy(slot, c.id, -1)}
                          className="rounded p-1 text-muted-foreground hover:text-brand disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="한 칸 아래로"
                          disabled={pending || idx === ordered.length - 1}
                          onClick={() => moveBy(slot, c.id, 1)}
                          className="rounded p-1 text-muted-foreground hover:text-brand disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
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
                      <span className={cn("inline-flex items-center gap-1 text-xs", c.feeCustom && "text-coral font-semibold")}>
                        {c.expectedFeeMax !== null && c.expectedFeeMax !== undefined && c.expectedFeeMax !== c.expectedFee && (
                          <span className="text-muted-foreground" title="회차·병행 범위 총액 — 아래 칸에 적으면 확정 금액으로 바뀝니다">
                            {feeText(c)} →
                          </span>
                        )}
                        <Input
                          inputMode="numeric"
                          defaultValue={formatComma(c.expectedFee)}
                          onInput={commaInputHandler}
                          placeholder="예정가(원)"
                          className={cn("h-7 w-28 text-xs tabular-nums", c.feeCustom && "border-coral text-coral")}
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
                        원{c.feeCustom && <span className="text-[10px]">(개별 수정)</span>}
                      </span>
                    ) : (
                      <span className={cn("text-xs text-muted-foreground", c.feeCustom && "text-coral font-semibold")}>
                        {feeText(c)}
                        {c.feeCustom && " (개별 수정)"}
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
