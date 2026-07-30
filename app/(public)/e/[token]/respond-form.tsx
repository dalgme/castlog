"use client";

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { respondToEngagementByToken } from "./actions";

/** 섭외 수락·거절 폼 — 모바일 완전 대응 (공개 링크) */
export function EngagementRespondForm({ token }: { token: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  function onRespond(decision: "accepted" | "declined") {
    if (
      decision === "accepted" &&
      !window.confirm("섭외를 수락하시겠습니까? 수락 시 계약이 성립합니다.")
    ) {
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await respondToEngagementByToken(token, {
        decision,
        responseNote: note || undefined,
      });
      if (result.ok) {
        setDone(result.decision);
      } else {
        setServerError(result.error);
      }
    });
  }

  if (done) {
    return (
      <Alert>
        <AlertDescription>
          {done === "accepted"
            ? "섭외를 수락했습니다. 계약이 성립되었으며 기업 담당자에게 전달됩니다."
            : "섭외를 거절했습니다. 기업 담당자에게 전달됩니다."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
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
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("accepted")}
        >
          {pending ? "처리 중..." : "수락"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("declined")}
        >
          거절
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        수락 시 계약이 성립하며, 응답 내역은 기업과 전문가 포털에 기록됩니다.
      </p>
    </div>
  );
}
