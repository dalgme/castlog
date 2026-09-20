"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";

import {
  manualAcceptEngagement,
  manualDeclineEngagement,
} from "../../experts/engagement-actions";

/**
 * 후보별 승인·거절 (기획 지시 2026-09-21) — 섭외 진행 현황 표의 회신 대기 행.
 * 전화 등으로 확인한 회신을 담당자가 대신 표시한다. 승인 = 계약 성립(수락서 자동 생성),
 * 거절 = 자리 해제. 되돌리기 어려운 행위라 한 번 되묻는다 (§14-3).
 */
export function EngagementDecisionButtons({
  engagementId,
  projectId,
  expertName,
  expertsLite,
}: {
  engagementId: string;
  projectId: string;
  expertName: string;
  expertsLite: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsPmApproval, setNeedsPmApproval] = useState(false);

  function close() {
    setMode(null);
    setNote("");
    setError(null);
    setNeedsPmApproval(false);
  }

  function submit() {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      const r =
        mode === "accept"
          ? await manualAcceptEngagement(engagementId, note, expertsLite)
          : await manualDeclineEngagement(engagementId, note);
      if (!r.ok) {
        setError(r.error);
        setNeedsPmApproval(Boolean(r.needsPmApproval));
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          className="h-7 bg-yellow-400 px-2 text-[11px] text-yellow-950 hover:bg-yellow-500"
          title="전화 등으로 수락을 확인했을 때 — 계약 성립(수락서 자동 생성)"
          onClick={() => setMode("accept")}
        >
          <Check className="mr-0.5 h-3 w-3" aria-hidden />
          승인
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:bg-neutral-200"
          title="전화 등으로 거절을 확인했을 때 — 자리를 비웁니다"
          onClick={() => setMode("decline")}
        >
          <X className="mr-0.5 h-3 w-3" aria-hidden />
          거절
        </Button>
      </span>
      <Dialog open={mode !== null} onOpenChange={(v) => !v && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "accept" ? `${expertName} — 승인(수락)으로 처리할까요?` : `${expertName} — 거절로 처리할까요?`}
            </DialogTitle>
            <DialogDescription>
              {mode === "accept"
                ? "전문가가 수락한 것으로 기록되어 계약이 성립하고 수락서가 자동 생성됩니다. 전문가 본인이 링크로 응답한 것이 아니라 담당자 수동 처리로 이력에 남습니다."
                : "전문가가 거절한 것으로 기록되고 이 자리는 다시 비어 다른 후보에게 요청할 수 있습니다. 이력에는 담당자 수동 처리로 남습니다."}
            </DialogDescription>
          </DialogHeader>
          {error && !needsPmApproval && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {needsPmApproval && (
            <DeputyRequestInline projectId={projectId} actionType="engagement.manual_accept" targetId={engagementId} />
          )}
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "accept" ? "확인 경로·메모 (선택) — 예: 9/21 전화로 확인" : "거절 사유·메모 (선택)"}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              닫기
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending}
              className={mode === "accept" ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-500" : undefined}
              variant={mode === "decline" ? "destructive" : "default"}
            >
              {pending ? "처리 중…" : mode === "accept" ? "승인으로 처리" : "거절로 처리"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
