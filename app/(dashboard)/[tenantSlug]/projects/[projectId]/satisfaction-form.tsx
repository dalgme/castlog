"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, Plus } from "lucide-react";

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

/** 자주 쓰는 값만 빠른 버튼으로 — 나머지는 슬라이더·증감으로 맞춘다 */
const QUICK = [60, 70, 80, 90, 100];

function toneOf(value: number): string {
  if (value >= 90) return "bg-emerald-600";
  if (value >= 70) return "bg-brand";
  if (value >= 50) return "bg-amber-500";
  return "bg-destructive";
}

/**
 * 세션별 전문가 만족도 (0~100, 5점 단위).
 *
 * 처음에는 5점 단위 버튼 21개를 늘어놓았는데, 한 프로젝트에 참여 건이 열 개만
 * 돼도 화면이 버튼 200개가 됐다. 무엇을 눌러야 하는지가 아니라 '버튼이 많다'가
 * 먼저 보이면 그 화면은 실패한 것이다.
 *
 * 그래서 슬라이더(5점 단위로 스냅) + 자주 쓰는 값 몇 개 + 미세 조정으로 바꿨다.
 * 저장은 손을 뗄 때 자동으로 한다 — 점수마다 저장 버튼을 누르게 하지 않는다.
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
  const [value, setValue] = useState<number>(row.satisfaction ?? 80);
  const [saved, setSaved] = useState(row.satisfaction !== null);
  const [memo, setMemo] = useState(row.memo ?? "");
  const [memoOpen, setMemoOpen] = useState(Boolean(row.memo));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function commit(next: number, nextMemo = memo) {
    const clamped = Math.min(100, Math.max(0, Math.round(next / 5) * 5));
    setValue(clamped);
    startTransition(async () => {
      const res = await saveSessionSatisfaction({
        projectId,
        expertId: row.expertId,
        slotId: row.slotId,
        satisfaction: clamped,
        memo: nextMemo,
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: res.error });
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{row.expertName}</span>
          {row.positionCode && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {row.positionCode}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {row.sessionName} · {row.schedule}
        </p>
        {!memoOpen && !disabled && (
          <button
            type="button"
            onClick={() => setMemoOpen(true)}
            className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-brand hover:underline"
          >
            메모 추가
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-11 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white ${
              saved ? toneOf(value) : "bg-muted-foreground/40"
            }`}
          >
            {saved ? value : "–"}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value}
            disabled={disabled || pending}
            onChange={(e) => setValue(Number(e.target.value))}
            onPointerUp={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            aria-label={`${row.expertName} ${row.sessionName} 만족도`}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#1A68F0]"
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="5점 내림"
              disabled={disabled || pending || value <= 0}
              onClick={() => commit(value - 5)}
              className="rounded border p-1 text-muted-foreground transition-colors hover:text-brand disabled:opacity-40"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="5점 올림"
              disabled={disabled || pending || value >= 100}
              onClick={() => commit(value + 5)}
              className="rounded border p-1 text-muted-foreground transition-colors hover:text-brand disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="w-4 shrink-0">
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : null}
          </span>
        </div>

        {!disabled && (
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                disabled={pending}
                onClick={() => commit(q)}
                className={
                  saved && value === q
                    ? "rounded border border-brand bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand"
                    : "rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                }
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {memoOpen && (
        <div className="sm:col-span-2">
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            onBlur={() => saved && commit(value, memo)}
            disabled={disabled || pending}
            rows={2}
            maxLength={1000}
            placeholder="메모 (선택) — 회사 내부 기록이며 전문가에게 공개되지 않습니다."
            className="text-sm"
          />
        </div>
      )}
    </li>
  );
}

/** 목록 위에 붙는 안내 — 개별 행마다 반복하지 않는다 */
export function SatisfactionHint({ readOnly }: { readOnly: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      {readOnly
        ? "검토 요청 이후에는 수정할 수 없습니다."
        : "0~100점, 5점 단위입니다. 손을 떼면 자동 저장됩니다."}
    </p>
  );
}

/** 만족도 요약 막대 — 몇 건이 남았는지 한눈에 */
export function SatisfactionProgress({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
        <div
          className={pct === 100 ? "h-full bg-emerald-600" : "h-full bg-brand"}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}
