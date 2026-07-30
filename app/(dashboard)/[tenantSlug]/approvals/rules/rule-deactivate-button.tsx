"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { deactivateApprovalRule } from "../actions";

/** 전결규정 폐지(비활성화) — 이력 행은 보존된다 */
export function RuleDeactivateButton({ ruleId }: { ruleId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onDeactivate() {
    // 위험 작업 2단계 확인 (CLAUDE.md 14-3)
    if (!window.confirm("이 규정을 폐지할까요? 진행 중인 결재건에는 영향이 없습니다.")) {
      return;
    }
    startTransition(async () => {
      const result = await deactivateApprovalRule(ruleId);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={onDeactivate}
    >
      {pending ? "처리 중..." : "폐지"}
    </Button>
  );
}
