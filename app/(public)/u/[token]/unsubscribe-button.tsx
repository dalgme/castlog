"use client";

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { processUnsubscribe } from "./actions";

/** 수신거부 확인 버튼 — 오클릭·크롤러 방지를 위해 명시적 확인 후 처리 */
export function UnsubscribeButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <Alert>
        <AlertDescription>
          수신거부가 완료되었습니다. 앞으로 이 발송처의 광고성 메시지를 받지
          않습니다. (업무 관련 필수 연락은 계속 수신될 수 있습니다.)
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await processUnsubscribe(token);
            if (result.ok) setDone(true);
            else setError(result.error);
          });
        }}
      >
        {pending ? "처리 중..." : "광고성 메시지 수신거부"}
      </Button>
    </div>
  );
}
