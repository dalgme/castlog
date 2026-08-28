"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { respondEngagementAsExpert } from "./actions";

/**
 * 포털 내 섭외 수락·거절 — 모바일 완전 대응.
 * 수락·거절 모두 확인 단계를 거친다 — 되돌릴 수 없는 응답이 원터치로 확정되면
 * 오터치를 되돌릴 수 없다 (검수 C1). 거절 확인에서는 사유 입력을 유도한다.
 */
export function EngagementRespondButtons({
  engagementId,
}: {
  engagementId: string;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"accepted" | "declined" | null>(
    null
  );
  const { toast } = useToast();

  function submit(decision: "accepted" | "declined") {
    startTransition(async () => {
      const result = await respondEngagementAsExpert(engagementId, {
        decision,
        responseNote: note || undefined,
      });
      setConfirming(null);
      if (result.ok) {
        toast({
          description:
            decision === "accepted"
              ? "섭외를 수락했습니다. 계약이 성립되었습니다."
              : "섭외를 거절했습니다. 잘못 응답하셨다면 기업 담당자에게 연락해 주세요.",
        });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  if (confirming) {
    const accepting = confirming === "accepted";
    return (
      <div className="mt-2 space-y-2">
        <div
          className={`rounded-lg border p-2.5 text-xs leading-relaxed ${
            accepting
              ? "border-brand/40 bg-brand/[0.05]"
              : "border-amber-300 bg-amber-50"
          }`}
        >
          {accepting ? (
            <>
              <b>섭외를 수락하시겠습니까?</b> 수락 시 계약이 성립하며 수락서가
              만들어집니다.
            </>
          ) : (
            <>
              <b>섭외를 거절하시겠습니까?</b> 거절 후에는 이 요청에 다시 응답할
              수 없습니다. 가능하면 아래에 사유를 남겨 주세요.
              <Textarea
                rows={2}
                className="mt-2 bg-white"
                placeholder="거절 사유 (선택 — 예: 일정 겹침)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
              />
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            돌아가기
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            variant={accepting ? "default" : "destructive"}
            disabled={pending}
            onClick={() => submit(confirming)}
          >
            {pending ? "처리 중..." : accepting ? "예, 수락합니다" : "예, 거절합니다"}
          </Button>
        </div>
      </div>
    );
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
          onClick={() => setConfirming("accepted")}
        >
          수락
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming("declined")}
        >
          거절
        </Button>
      </div>
    </div>
  );
}
