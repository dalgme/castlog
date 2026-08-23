"use client";

import { useTransition } from "react";

import {
  STEP_STATUS_LABELS,
  STEP_STATUSES,
  type StepStatus,
} from "@/lib/operations/steps";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import { updateStepStatus } from "../actions";

/**
 * 진행 단계를 클릭으로 선택 (기획 확정 2026-08-23).
 * 수동 스텝은 셀렉트 대신 단계 버튼을 눌러 바로 바꾼다 — PL이 회의 중에도
 * 한 클릭으로 진행 상태를 남길 수 있어야 한다.
 */
export function StepStatusButtons({
  stepId,
  status,
}: {
  stepId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function select(next: StepStatus) {
    if (next === status) return;
    startTransition(async () => {
      const result = await updateStepStatus({ stepId, status: next });
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <span
      className="inline-flex overflow-hidden rounded-md border"
      role="group"
      aria-label="진행 단계를 클릭으로 선택"
    >
      {STEP_STATUSES.map((value) => (
        <button
          key={value}
          type="button"
          disabled={pending}
          onClick={() => select(value)}
          className={cn(
            "px-2 py-1 text-[11px] transition-colors",
            value !== STEP_STATUSES[0] && "border-l",
            status === value
              ? value === "completed"
                ? "bg-emerald-600 font-semibold text-white"
                : value === "in_progress"
                  ? "bg-sky-600 font-semibold text-white"
                  : value === "skipped"
                    ? "bg-gray-400 font-semibold text-white"
                    : "bg-gray-600 font-semibold text-white"
              : "bg-background text-muted-foreground hover:bg-muted"
          )}
        >
          {STEP_STATUS_LABELS[value]}
        </button>
      ))}
    </span>
  );
}
