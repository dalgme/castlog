"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { cancelDocumentRequest } from "@/app/(dashboard)/[tenantSlug]/experts/document-request-actions";

/** 서류 요청 회수 버튼 (pending만) */
export function DocumentRequestCancelButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("이 서류 요청을 회수할까요? 링크가 무효화됩니다.")) return;
        startTransition(async () => {
          const result = await cancelDocumentRequest(requestId);
          if (!result.ok) {
            toast({ variant: "destructive", description: result.error });
          }
        });
      }}
    >
      {pending ? "처리 중..." : "회수"}
    </Button>
  );
}
