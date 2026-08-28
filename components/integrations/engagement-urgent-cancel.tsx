"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { cancelEngagement } from "@/app/(dashboard)/[tenantSlug]/experts/engagement-actions";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";

/**
 * 단계 29: 계약 성립(accepted) 섭외의 긴급 취소.
 * 사유 필수 — 취소 시 전사(테넌트 전원) 긴급 알림이 발생한다.
 */
export function EngagementUrgentCancel({
  engagementId,
  expertName,
}: {
  engagementId: string;
  expertName: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  // 부PM 게이트 거부 시 다이얼로그 안에서 바로 승인 요청 (검수 A1)
  const [approvalProjectId, setApprovalProjectId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onConfirm() {
    setServerError(null);
    if (!reason.trim()) {
      setServerError("긴급 취소 사유를 입력하세요.");
      return;
    }
    startTransition(async () => {
      const result = await cancelEngagement(engagementId, reason.trim());
      if (result.ok) {
        toast({ description: "섭외를 긴급 취소하고 전사 알림을 발생했습니다." });
        setOpen(false);
        setReason("");
      } else if (result.needsPmApproval && result.projectId) {
        setApprovalProjectId(result.projectId);
      } else {
        setServerError(result.error);
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason("");
      setServerError(null);
      setApprovalProjectId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
        >
          <AlertTriangle className="mr-1 h-3.5 w-3.5" />
          긴급 취소
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>섭외 긴급 취소</DialogTitle>
          <DialogDescription>
            {expertName} 전문가의 계약 성립된 섭외를 취소합니다. 취소 시 전사에
            긴급 알림이 발생하며 취소 내역에 기록됩니다. 사유는 필수입니다.
          </DialogDescription>
        </DialogHeader>
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        {approvalProjectId && (
          <DeputyRequestInline
            projectId={approvalProjectId}
            actionType="engagement.cancel"
            targetId={engagementId}
          />
        )}
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="취소 사유 (예: 행사 취소, 일정 변경 등)"
          disabled={pending}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            닫기
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "취소 중..." : "긴급 취소 실행"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
