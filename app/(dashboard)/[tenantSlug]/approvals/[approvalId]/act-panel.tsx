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
}: {
  tenantSlug: string;
  approvalId: string;
  canAct: boolean;
  actingAsDelegate: boolean;
  canCancel: boolean;
  canResubmit: boolean;
}) {
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function onAct(decision: "approve" | "reject") {
    startTransition(async () => {
      const result = await actOnApproval({
        approvalId,
        decision,
        comment: comment || undefined,
      });
      if (result.ok) {
        toast({
          description: decision === "approve" ? "승인했습니다." : "반려했습니다.",
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
          <Textarea
            rows={2}
            placeholder="결재 의견 (선택)"
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
              {pending ? "처리 중..." : "승인"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={pending}
              onClick={() => onAct("reject")}
            >
              반려
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
