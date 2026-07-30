"use client";

import { useTransition } from "react";

import { STEP_STATUS_LABELS, STEP_STATUSES, type StepStatus } from "@/lib/operations/steps";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { updateStepStatus } from "../actions";

/** 스텝 상태 변경 셀렉트 — 실무자 전원 사용 가능 (RLS tenant 범위) */
export function StepStatusSelect({
  stepId,
  status,
}: {
  stepId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onChange(next: string) {
    startTransition(async () => {
      const result = await updateStepStatus({
        stepId,
        status: next as StepStatus,
      });
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <Select value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STEP_STATUSES.map((value) => (
          <SelectItem key={value} value={value} className="text-xs">
            {STEP_STATUS_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
