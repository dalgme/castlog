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
  reviseEngagementDecision,
} from "../../experts/engagement-actions";

/**
 * 이미 내려진 결정 수정 (기획 지시 2026-09-21) — 거절 행의 '승인으로 변경',
 * 승인 행(수락서 발송 전)의 '거절로 변경'. 담당자가 눌렀든 전문가가 링크로 눌렀든 같다.
 */
export function EngagementReviseButton({
  engagementId,
  projectId,
  expertName,
  to,
}: {
  engagementId: string;
  projectId: string;
  expertName: string;
  to: "accepted" | "declined";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsPmApproval, setNeedsPmApproval] = useState(false);
  const toAccept = to === "accepted";

  function close() {
    setOpen(false);
    setNote("");
    setError(null);
    setNeedsPmApproval(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await reviseEngagementDecision(engagementId, to, note);
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
      {/* 거절 행은 붉은 '거절' 버튼이 현재 상태다 — 누르면 승인으로 바꿀 수 있다 (기획 지시 2026-09-21) */}
      <Button
        type="button"
        size="sm"
        variant={toAccept ? "default" : "outline"}
        className={
          toAccept
            ? "h-7 bg-red-600 px-2 text-[11px] font-semibold text-white hover:bg-red-700"
            : "h-6 px-1.5 text-[10px] text-muted-foreground hover:bg-neutral-200"
        }
        title={toAccept ? "거절됨 — 누르면 승인(수락)으로 바꿀 수 있습니다" : "승인을 거절로 바꿉니다 (확정 단계도 가능) — 자리를 비워 후보 재등록·변경 상신"}
        onClick={() => setOpen(true)}
      >
        <X className="mr-0.5 h-3 w-3" aria-hidden />
        {toAccept ? "거절" : "거절로 변경"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {toAccept ? `${expertName} — 거절을 승인으로 바꿀까요?` : `${expertName} — 승인을 거절로 바꿀까요?`}
            </DialogTitle>
            <DialogDescription>
              {toAccept
                ? "이 자리에 같은 전문가가 그대로 배정돼 있을 때만 됩니다. 섭외 건이 되살아나 계약이 성립하고 수락서가 자동 생성됩니다. 이력에는 담당자 결정 수정으로 남습니다."
                : "확정(수락서 송부·서명·확정) 단계여도 됩니다. 자리는 다시 비어 섭외후보 등록 탭에서 후보를 다시 넣고 변경 품의(또는 긴급 진행)를 올릴 수 있습니다. 발송 전 수락서는 지워지고, 이미 송부·서명·확정된 수락서는 기록으로 남으며 전문가에게 포털 알림이 갑니다."}
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
            placeholder="수정 사유·메모 (선택) — 예: 9/21 전화로 다시 확인"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              닫기
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending}
              className={toAccept ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-500" : undefined}
              variant={toAccept ? "default" : "destructive"}
            >
              {pending ? "처리 중…" : toAccept ? "승인으로 변경" : "거절로 변경"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
