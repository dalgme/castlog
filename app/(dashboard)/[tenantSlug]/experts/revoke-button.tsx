"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { revokeExpertInvitation } from "./actions";

/** 대기중 등록 요청 회수 버튼 */
export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onRevoke() {
    startTransition(async () => {
      const result = await revokeExpertInvitation(invitationId);
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
      onClick={onRevoke}
    >
      {pending ? "회수 중..." : "회수"}
    </Button>
  );
}
