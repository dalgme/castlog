"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { cancelEngagement } from "@/app/(dashboard)/[tenantSlug]/experts/engagement-actions";

/** 섭외 요청 회수 — 응답 전(requested)만 가능 */
export function EngagementCancelButton({ engagementId }: { engagementId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onCancel() {
    if (!window.confirm("이 섭외 요청을 회수할까요? 동의 링크가 무효화됩니다.")) {
      return;
    }
    startTransition(async () => {
      const result = await cancelEngagement(engagementId);
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
      onClick={onCancel}
    >
      {pending ? "처리 중..." : "회수"}
    </Button>
  );
}
