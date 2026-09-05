"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";

import { resendEngagementSms, resendSlotEngagementSms } from "./resend-actions";

/** 섭외 문자 발송 이력 요약 — 한 섭외 건(멘토)에 나간 문자 (sms_logs.engagement_ids) */
export type SmsSummary = {
  count: number;
  lastAt: string | null;
  /** sent | failed | test */
  lastStatus: string | null;
  lastError: string | null;
  items: { at: string; status: string; error: string | null; preview: string }[];
};

export const SMS_STATUS_LABELS: Record<string, string> = {
  sent: "발송 성공",
  failed: "발송 실패",
  test: "테스트 모드(미발송)",
  blocked: "차단",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 셀에 들어가는 한 줄 요약 + 이력 다이얼로그 */
export function SmsHistoryCell({
  sms,
  expertName,
}: {
  sms: SmsSummary | null;
  expertName: string;
}) {
  if (!sms || sms.count === 0) {
    return <span className="text-[11px] text-muted-foreground">문자 기록 없음</span>;
  }
  const tone =
    sms.lastStatus === "failed"
      ? "text-red-700"
      : sms.lastStatus === "test"
        ? "text-amber-800"
        : "text-emerald-700";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1 rounded px-1 text-left text-[11px] tabular-nums hover:bg-secondary"
          title="문자 발송 이력 보기"
        >
          <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {sms.count}회 · {sms.lastAt ? when(sms.lastAt) : "-"}
          </span>
          <span className={cn("font-semibold", tone)}>
            {SMS_STATUS_LABELS[sms.lastStatus ?? ""] ?? sms.lastStatus}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{expertName} — 섭외 문자 발송 이력</DialogTitle>
          <DialogDescription>
            이 섭외 건으로 나간 문자입니다 (최근 순 · 세션 안내 문자는 제외).
            실패 사유는 공급자 응답 그대로입니다.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y overflow-y-auto text-sm">
          {sms.items.map((it, i) => (
            <li key={i} className="space-y-0.5 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="tabular-nums text-muted-foreground">{when(it.at)}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-semibold",
                    it.status === "failed"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : it.status === "test"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  )}
                >
                  {SMS_STATUS_LABELS[it.status] ?? it.status}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{it.preview}</p>
              {it.error && <p className="text-xs text-red-700">{it.error}</p>}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** 멘토(섭외 건) 한 명에게 재발송 */
export function ResendSmsButton({
  engagementId,
  projectId,
  expertName,
  size = "xs",
}: {
  engagementId: string;
  projectId: string;
  expertName: string;
  size?: "xs" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsPmApproval, setNeedsPmApproval] = useState(false);
  const [done, setDone] = useState(false);

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await resendEngagementSms(engagementId);
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(r.error);
        setNeedsPmApproval(Boolean(r.needsPmApproval));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setNeedsPmApproval(false);
          setDone(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size === "xs" ? "sm" : size}
          className={cn(size === "xs" && "h-7 px-2 text-[11px]")}
          title="섭외 요청 문자를 다시 보냅니다"
        >
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
          문자 재발송
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{expertName}에게 섭외 문자를 다시 보낼까요?</DialogTitle>
          <DialogDescription>
            같은 섭외 건의 동의 링크를 새로 발급해 문자로 보내고, 회신 마감을
            연장합니다. 이전 링크는 사용할 수 없게 됩니다. 새 섭외 건이 생기지는
            않습니다.
          </DialogDescription>
        </DialogHeader>
        {error && !needsPmApproval && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {needsPmApproval && (
          <DeputyRequestInline
            projectId={projectId}
            actionType="engagement.remind"
            targetId={engagementId}
          />
        )}
        {done ? (
          <Alert>
            <AlertDescription>다시 보냈습니다. 발송 결과는 문자 이력에서 확인하세요.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button type="button" onClick={send} disabled={pending}>
              {pending ? "보내는 중…" : "다시 보내기"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 세션의 회신 대기 전원에게 재발송 */
export function ResendSlotButton({
  projectId,
  slotId,
  sessionLabel,
  waitingCount,
}: {
  projectId: string;
  slotId: string;
  sessionLabel: string;
  waitingCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: number;
    failed: { code: string; reason: string }[];
    bundled: string[];
  } | null>(null);

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await resendSlotEngagementSms(projectId, slotId);
      if (r.ok) {
        setResult({ sent: r.sent, failed: r.failed, bundled: r.bundled });
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={waitingCount === 0}
          title={
            waitingCount === 0
              ? "회신을 기다리는 요청이 없습니다"
              : "회신 대기 중인 전원에게 섭외 문자를 다시 보냅니다"
          }
        >
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
          회신 대기 {waitingCount}명 재발송
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sessionLabel} — 회신 대기 {waitingCount}명에게 재발송</DialogTitle>
          <DialogDescription>
            각 건의 동의 링크를 새로 발급해 문자로 보내고 회신 마감을 연장합니다.
            이전 링크는 사용할 수 없게 됩니다. 같은 묶음으로 요청받은 전문가에게는
            한 통만 보냅니다. 부PM은 멘토별 버튼에서 건별로 승인을 요청합니다.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {result ? (
          <div className="space-y-2">
            <Alert>
              <AlertDescription>
                <strong>{result.sent}명</strong>에게 다시 보냈습니다.
                {result.bundled.length > 0 &&
                  ` ${result.bundled.length}건은 같은 묶음이라 함께 안내됐습니다 (${result.bundled.join(", ")}).`}
                {result.failed.length > 0 && ` ${result.failed.length}건은 보내지 못했습니다.`}
              </AlertDescription>
            </Alert>
            {result.failed.length > 0 && (
              <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">
                {result.failed.map((f) => (
                  <li key={f.code}>
                    <span className="font-mono">{f.code}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button type="button" onClick={send} disabled={pending}>
              {pending ? "보내는 중…" : `${waitingCount}명에게 다시 보내기`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
