"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, MonitorSmartphone } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  sendAcceptanceLetters,
  type DispatchChannel,
} from "./position-assign-actions";

const CHANNELS: { value: DispatchChannel; label: string; note: string }[] = [
  { value: "sms", label: "문자", note: "이메일을 등록하지 않은 분에게도 닿습니다." },
  { value: "email", label: "이메일", note: "이메일이 없는 분에게는 가지 않습니다." },
  {
    value: "both",
    label: "문자 + 이메일",
    note: "가장 확실합니다. 발송 건수가 두 배가 됩니다.",
  },
];

/**
 * 수락서 일괄 송신.
 *
 * 여기서 반드시 이해시켜야 하는 것이 하나 있다: **문자·이메일은 수락서가 아니다.**
 * 수락서는 캐스트로그 화면에서만 열리고, 문자·이메일은 '도착했다'는 안내다.
 * 담당자가 이걸 오해하면 "문자로 보냈으니 전달 끝"이라고 생각하고 전문가의 확인·
 * 승인을 기다리지 않는다. 그래서 안내 문구를 강조 박스로 고정해 둔다.
 */
export function AcceptanceSendDialog({
  projectId,
  targetCount,
  alreadySent,
  disabled,
  disabledReason,
}: {
  projectId: string;
  targetCount: number;
  /** 이미 한 번 나갔는가 — 재송신이면 문구가 달라진다 */
  alreadySent: boolean;
  disabled: boolean;
  disabledReason: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: number;
    skipped: number;
    attached: number;
    failed: { name: string; reason: string }[];
  } | null>(null);

  const [channel, setChannel] = useState<DispatchChannel>("both");
  const [memo, setMemo] = useState("");

  const label = alreadySent ? "수락서 재송신" : "수락서 송신";

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await sendAcceptanceLetters({ projectId, channel, memo });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        sent: res.sent,
        skipped: res.skipped,
        attached: res.attached,
        failed: res.failed,
      });
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <span
        title={disabledReason}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground"
      >
        <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
    );
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
        <Button size="sm" variant={alreadySent ? "outline" : "default"}>
          <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            이 프로젝트에 귀속된 전문가 전원에게 수락서 및 안내문 등을 송신할까요?
          </DialogTitle>
          <DialogDescription>
            수락 완료된 <strong>{targetCount}명</strong>의 수락서가 자동 생성되어
            각자의 캐스트로그 화면에 올라갑니다. 등록해 둔 공통·개별 첨부도 함께
            붙습니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                <strong>{result.sent}명</strong>에게 수락서를 송신했습니다.
                {result.attached > 0 && ` 첨부 ${result.attached}건이 함께 붙었습니다.`}
                {result.skipped > 0 &&
                  ` ${result.skipped}명은 이미 확인이 끝나 건너뛰었습니다.`}
                <br />
                전문가가 ‘수락서 정보 확인 완료 및 승인(서명)’을 마치면 이 화면의
                상태가 자동으로 <strong>확정</strong>으로 바뀝니다.
              </AlertDescription>
            </Alert>
            {result.failed.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-semibold">
                    {result.failed.length}건은 보내지 못했습니다
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {result.failed.map((f) => (
                      <li key={f.name} className="text-xs">
                        · {f.name} — {f.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Button className="w-full" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">송신 알림</legend>
              {CHANNELS.map((c) => (
                <Label
                  key={c.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 font-normal transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/5"
                >
                  <input
                    type="radio"
                    name="acceptance-channel"
                    className="mt-0.5"
                    checked={channel === c.value}
                    onChange={() => setChannel(c.value)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.note}
                    </span>
                  </span>
                </Label>
              ))}
            </fieldset>

            <div>
              <Label htmlFor="acceptance-memo">함께 보낼 안내 문구 (선택)</Label>
              <Textarea
                id="acceptance-memo"
                rows={3}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="확인 기한, 준비물, 제출 서류 안내 등 — 전원에게 같은 내용으로 나갑니다."
              />
            </div>

            {/* 이 안내가 이 화면의 핵심이다 — 눈에 띄지 않으면 오해가 남는다 */}
            <div className="rounded-lg border-2 border-brand bg-brand/[0.06] p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-brand-navy">
                <MonitorSmartphone className="h-4 w-4 text-brand" aria-hidden />
                수락서는 캐스트로그로 전달됩니다
              </p>
              <p className="mt-1.5 text-xs font-semibold leading-relaxed text-brand-navy">
                수락서는 캐스트로그로 전달되므로 전문가분들도 캐스트로그를 통해
                확인하셔야 하며, ‘문자/이메일’ 등은 수락서가 캐스트로그에
                송신되었다는 안내를 보내는 것입니다.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                아니오
              </Button>
              <Button className="flex-1" onClick={send} disabled={pending}>
                <FileCheck2 className="mr-1.5 h-4 w-4" />
                {pending ? "송신 중…" : `예, ${targetCount}명에게 송신합니다`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
