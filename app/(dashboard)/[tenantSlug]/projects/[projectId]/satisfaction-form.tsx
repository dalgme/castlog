"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { saveSessionSatisfaction } from "./closing-actions";

export type SatisfactionRow = {
  expertId: string;
  expertName: string;
  slotId: string | null;
  sessionName: string;
  schedule: string;
  positionCode: string | null;
  satisfaction: number | null;
  memo: string | null;
};

/** 0~100, 5점 단위 — 슬라이더로 두면 5의 배수를 정확히 맞추기 어렵다 */
const STEPS = Array.from({ length: 21 }, (_, i) => i * 5);

/**
 * 세션별 전문가 만족도.
 *
 * 사람 단위가 아니라 **참여 세션 단위**로 매긴다. 같은 전문가라도 세션마다
 * 다르게 진행되고, 다음에 어느 자리에 다시 부를지는 그 차이를 봐야 정해진다.
 */
export function SatisfactionForm({
  projectId,
  row,
  disabled,
}: {
  projectId: string;
  row: SatisfactionRow;
  /** 검토 요청 이후에는 고칠 수 없다 */
  disabled: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<number | null>(row.satisfaction);
  const [memo, setMemo] = useState(row.memo ?? "");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function save(next: number) {
    setValue(next);
    startTransition(async () => {
      const res = await saveSessionSatisfaction({
        projectId,
        expertId: row.expertId,
        slotId: row.slotId,
        satisfaction: next,
        memo,
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: res.error });
        setValue(row.satisfaction);
        return;
      }
      router.refresh();
    });
  }

  function saveMemo() {
    if (value === null) {
      toast({ variant: "destructive", description: "만족도를 먼저 선택하세요." });
      return;
    }
    startTransition(async () => {
      const res = await saveSessionSatisfaction({
        projectId,
        expertId: row.expertId,
        slotId: row.slotId,
        satisfaction: value,
        memo,
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: res.error });
        return;
      }
      toast({ description: "메모를 저장했습니다." });
      router.refresh();
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">{row.expertName}</span>
        <span className="text-xs text-muted-foreground">{row.sessionName}</span>
        <span className="text-xs text-muted-foreground">{row.schedule}</span>
        {row.positionCode && (
          <span className="font-mono text-xs text-muted-foreground">
            {row.positionCode}
          </span>
        )}
        <span
          className={
            value === null
              ? "ml-auto rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
              : "ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700"
          }
        >
          {value === null ? "만족도 미입력" : `만족도 ${value}점`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            disabled={disabled || pending}
            onClick={() => save(step)}
            aria-pressed={value === step}
            className={
              value === step
                ? "min-w-[2.6rem] rounded-md border border-brand bg-brand px-1.5 py-1 text-xs font-semibold text-white"
                : "min-w-[2.6rem] rounded-md border px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
            }
          >
            {step}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        <Textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={disabled || pending}
          rows={2}
          maxLength={1000}
          placeholder="메모 (선택) — 회사 내부 기록이며 전문가에게 공개되지 않습니다."
          className="text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || pending}
          onClick={saveMemo}
        >
          메모 저장
        </Button>
      </div>
    </li>
  );
}
