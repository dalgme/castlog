"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";

import { cancelEngagement } from "@/app/(dashboard)/[tenantSlug]/experts/engagement-actions";

/** 섭외 요청 회수 — 응답 전(requested)만 가능 */
export function EngagementCancelButton({ engagementId }: { engagementId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  // 부PM 게이트에 걸리면 그 자리에서 승인 요청을 띄운다 (검수 A1)
  const [approvalProjectId, setApprovalProjectId] = useState<string | null>(null);

  function onCancel() {
    if (!window.confirm("이 섭외 요청을 회수할까요? 동의 링크가 무효화됩니다.")) {
      return;
    }
    startTransition(async () => {
      const result = await cancelEngagement(engagementId);
      if (!result.ok) {
        if (result.needsPmApproval && result.projectId) {
          setApprovalProjectId(result.projectId);
        } else {
          toast({ variant: "destructive", description: result.error });
        }
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={pending}
        onClick={onCancel}
      >
        {pending ? "처리 중..." : "회수"}
      </Button>
      {approvalProjectId && (
        <DeputyRequestInline
          projectId={approvalProjectId}
          actionType="engagement.withdraw"
          targetId={engagementId}
        />
      )}
    </span>
  );
}
