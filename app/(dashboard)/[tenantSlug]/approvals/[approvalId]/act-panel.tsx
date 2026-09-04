"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { actOnApproval, cancelApproval, resubmitApproval } from "../actions";

/**
 * 결재 처리 패널 — 승인·반려(의견), 상신 취소, 반려 후 재상신.
 * 모바일 완전 대응 대상 (결재 승인·반려 — CLAUDE.md 10).
 */
export function ActPanel({
  tenantSlug,
  approvalId,
  canAct,
  actingAsDelegate,
  canCancel,
  canResubmit,
  kind = "decision",
}: {
  tenantSlug: string;
  approvalId: string;
  canAct: boolean;
  actingAsDelegate: boolean;
  canCancel: boolean;
  canResubmit: boolean;
  /** 38번: 사후보고 문서는 승인/반려가 아니라 확인/피드백 */
  kind?: "decision" | "report";
}) {
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const isReport = kind === "report";

  function onAct(decision: "approve" | "reject") {
    if (isReport && decision === "reject" && !comment.trim()) {
      toast({
        variant: "destructive",
        description: "피드백 내용을 적어 주세요 — 담당자가 무엇을 고쳐야 하는지 알 수 있어야 합니다.",
      });
      return;
    }
    startTransition(async () => {
      const result = await actOnApproval({
        approvalId,
        decision,
        comment: comment || undefined,
      });
      if (result.ok) {
        toast({
          description: isReport
            ? decision === "approve"
              ? "확인했습니다."
              : "피드백을 남겼습니다. 담당자에게 표시됩니다."
            : decision === "approve"
              ? "승인했습니다."
              : "반려했습니다.",
        });
        setComment("");
        router.refresh();
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onCancel() {
    startTransition(async () => {
      const result = await cancelApproval(approvalId);
      if (result.ok) {
        toast({ description: "상신을 취소했습니다." });
        router.refresh();
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onResubmit() {
    startTransition(async () => {
      const result = await resubmitApproval(approvalId);
      if (result.ok) {
        toast({ description: "재상신했습니다." });
        router.push(`/${tenantSlug}/approvals/${result.approvalId}`);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  if (!canAct && !canCancel && !canResubmit) return null;

  return (
    <div className="space-y-3">
      {canAct && (
        <>
          {actingAsDelegate && (
            <p className="text-xs font-medium text-brand">
              대결 권한으로 처리합니다 — 처리 기록에 원 결재자와 함께 표시됩니다.
            </p>
          )}
          {isReport && (
            <p className="rounded-md bg-secondary/50 p-2 text-xs leading-relaxed text-muted-foreground">
              이 문서는 <b>사후보고</b>입니다 — 섭외는 이미 확정·진행 중이며,
              여기서의 확인·피드백은 진행을 되돌리지 않습니다. 고쳐야 할 점이
              있으면 피드백으로 남기면 담당자 화면에 표시됩니다.
            </p>
          )}
          <Textarea
            rows={2}
            placeholder={isReport ? "피드백 (피드백 시 필수)" : "결재 의견 (선택)"}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={pending}
              onClick={() => onAct("approve")}
            >
              {pending ? "처리 중..." : isReport ? "확인" : "승인"}
            </Button>
            <Button
              type="button"
              variant={isReport ? "outline" : "destructive"}
              className="flex-1"
              disabled={pending}
              onClick={() => onAct("reject")}
            >
              {isReport ? "피드백 남기기" : "반려"}
            </Button>
          </div>
        </>
      )}
      {canCancel && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={onCancel}
        >
          상신 취소
        </Button>
      )}
      {canResubmit && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={onResubmit}
        >
          재상신 (동일 결재라인)
        </Button>
      )}
    </div>
  );
}
