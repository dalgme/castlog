"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import {
  cancelBatch,
  confirmBatchSimple,
  markBatchPaid,
  submitBatchApproval,
} from "./actions";

/** 지급 건 상태별 액션 버튼 (재상신·단순 확정·지급 완료·취소) */
export function BatchActions({
  batchId,
  status,
  approvalsActive,
}: {
  batchId: string;
  status: string;
  approvalsActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function run(
    action: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>,
    confirmMessage?: string
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const result = await action(batchId);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  if (status === "pending") {
    return (
      <div className="flex items-center gap-1">
        {approvalsActive ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(submitBatchApproval)}
          >
            {pending ? "처리 중..." : "품의 상신"}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                confirmBatchSimple,
                "결재 없이 지급을 확정할까요? (전자결재 모듈 미사용 테넌트)"
              )
            }
          >
            {pending ? "처리 중..." : "단순 확정"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => run(cancelBatch, "이 지급 건을 취소할까요?")}
        >
          취소
        </Button>
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(markBatchPaid, "이체를 완료했습니까? 지급 완료로 기록합니다.")
        }
      >
        {pending ? "처리 중..." : "지급 완료 기록"}
      </Button>
    );
  }

  return null;
}
