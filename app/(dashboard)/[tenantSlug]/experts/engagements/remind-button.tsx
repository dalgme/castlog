"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";

import { remindEngagement } from "./reminder-actions";

/**
 * 미회신 재안내 — 회신 대기 중인 건에만 노출한다.
 *
 * 누르면 동의 링크가 새로 발급되고 이전 링크는 못 쓰게 되므로, 한 번 확인을 받는다
 * (되돌리기 어려운 외부 발송 — CLAUDE.md §14-3).
 */
export function RemindButton({
  engagementId,
  expertName,
  daysWaiting,
}: {
  engagementId: string;
  expertName: string;
  daysWaiting: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 부PM 게이트 거부 시 그 자리에서 승인 요청 (검수 A1)
  const [approvalProjectId, setApprovalProjectId] = useState<string | null>(null);

  const send = () => {
    setError(null);
    startTransition(async () => {
      const r = await remindEngagement(engagementId);
      if (!r.ok) {
        if (r.needsPmApproval && r.projectId) {
          setApprovalProjectId(r.projectId);
        } else {
          setError(r.error);
        }
        setConfirming(false);
      } else {
        setDone(true);
        setConfirming(false);
        router.refresh();
      }
    });
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <Check className="h-3.5 w-3.5" aria-hidden /> 재안내 발송
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="text-[11px] leading-tight text-muted-foreground">
          {expertName}님께 새 동의 링크를 보냅니다. 이전 링크는 사용할 수 없게 됩니다.
        </span>
        <span className="flex gap-1">
          <Button size="sm" disabled={pending} onClick={send}>
            {pending ? "발송 중…" : "보내기"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            취소
          </Button>
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
        재안내
        {daysWaiting >= 3 && (
          <span className="ml-1 text-[10px] text-amber-700">{daysWaiting}일 무응답</span>
        )}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      {approvalProjectId && (
        <DeputyRequestInline
          projectId={approvalProjectId}
          actionType="engagement.remind"
          targetId={engagementId}
        />
      )}
    </span>
  );
}
