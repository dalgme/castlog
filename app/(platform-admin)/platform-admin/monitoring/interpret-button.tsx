"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { interpretErrorLog } from "./actions";

/** 에러 행의 AI 해석 — 결과는 그 자리에서만 보여 주고 저장하지 않는다 */
export function InterpretButton({ errorId }: { errorId: string }) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (text) {
    return (
      <div className="mt-2 whitespace-pre-wrap rounded-md border bg-secondary/50 p-2.5 text-xs leading-relaxed">
        <p className="mb-1 font-semibold text-muted-foreground">
          AI 해석 (참고용 설명 — 수정 판단의 근거가 아님)
        </p>
        {text}
      </div>
    );
  }

  return (
    <span className="mt-1 inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await interpretErrorLog(errorId);
            if (result.ok) setText(result.text);
            else setError(result.error);
          })
        }
      >
        {pending ? "해석 중..." : "AI 해석"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
