"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { respondEngagementAsExpert } from "./actions";

/** 포털 내 섭외 수락·거절 — 모바일 완전 대응 */
export function EngagementRespondButtons({
  engagementId,
}: {
  engagementId: string;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onRespond(decision: "accepted" | "declined") {
    if (
      decision === "accepted" &&
      !window.confirm("섭외를 수락하시겠습니까? 수락 시 계약이 성립합니다.")
    ) {
      return;
    }
    startTransition(async () => {
      const result = await respondEngagementAsExpert(engagementId, {
        decision,
        responseNote: note || undefined,
      });
      if (result.ok) {
        toast({
          description:
            decision === "accepted" ? "섭외를 수락했습니다." : "섭외를 거절했습니다.",
        });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <Textarea
        rows={2}
        placeholder="의견 (선택)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("accepted")}
        >
          {pending ? "처리 중..." : "수락"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("declined")}
        >
          거절
        </Button>
      </div>
    </div>
  );
}
