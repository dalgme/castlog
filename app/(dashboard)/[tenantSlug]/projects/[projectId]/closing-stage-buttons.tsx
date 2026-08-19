"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlagOff, SendHorizontal } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  startProjectClosing,
  requestSettlementReview,
} from "./closing-actions";

/**
 * 종료 절차의 두 버튼 — 시작과 넘김.
 *
 * 둘 다 되돌리기 어려운 전환이라 한 번 되묻는다 (CLAUDE.md §14-3).
 * 막혀 있을 때는 무엇이 모자란지를 버튼 옆에 그대로 적는다 — '왜 안 눌리지'로
 * 담당자가 화면을 뒤지게 만들지 않는다.
 */
export function ClosingStageButtons({
  projectId,
  mode,
  disabledReason,
}: {
  projectId: string;
  mode: "start" | "request";
  /** 비어 있으면 활성 */
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const label = mode === "start" ? "프로젝트 종료" : "지급 품의 검토 요청";
  const question =
    mode === "start"
      ? "프로젝트를 종료하고 마감 입력(참여율·만족도)을 시작할까요?"
      : "입력을 마치고 회계담당자에게 지급 품의 검토를 요청할까요? 요청 후에는 만족도를 고칠 수 없습니다.";

  function run() {
    setError(null);
    startTransition(async () => {
      const res =
        mode === "start"
          ? await startProjectClosing(projectId)
          : await requestSettlementReview(projectId);
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {confirming ? (
        <div className="space-y-2 rounded-md border-2 border-brand bg-brand/[0.06] p-3">
          <p className="text-sm font-semibold text-brand-navy">{question}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={run} disabled={pending}>
              {pending ? "처리 중…" : "예, 진행합니다"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              아니오
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setConfirming(true)}
            disabled={pending || disabledReason !== null}
          >
            {mode === "start" ? (
              <FlagOff className="mr-1.5 h-4 w-4" />
            ) : (
              <SendHorizontal className="mr-1.5 h-4 w-4" />
            )}
            {label}
          </Button>
          {disabledReason && (
            <span className="text-xs text-muted-foreground">{disabledReason}</span>
          )}
        </div>
      )}
    </div>
  );
}
