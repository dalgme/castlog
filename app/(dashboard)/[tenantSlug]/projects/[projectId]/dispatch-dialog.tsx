"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  dispatchProjectEngagements,
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
 * 섭외 진행 — 배정된 전원에게 한 번에 요청을 보낸다.
 *
 * 되돌릴 수 없는 발송이므로 한 번 되묻는다 (CLAUDE.md §14-3: 위험 작업 2단계 확인).
 * 몇 명에게 무엇이 나가는지, 어떤 수단으로 나가는지를 눌러 확인한 뒤에만 나간다.
 */
export function DispatchDialog({
  projectId,
  projectName,
  targetCount,
  disabled,
  disabledReason,
}: {
  projectId: string;
  projectName: string;
  targetCount: number;
  disabled: boolean;
  disabledReason: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: number;
    failed: { code: string; reason: string }[];
  } | null>(null);

  const [channel, setChannel] = useState<DispatchChannel>("both");
  const [deadline, setDeadline] = useState("");
  const [programName, setProgramName] = useState(projectName);
  const [eventSummary, setEventSummary] = useState("");
  const [memo, setMemo] = useState("");

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await dispatchProjectEngagements({
        projectId,
        channel,
        deadline: deadline || undefined,
        programName,
        eventSummary,
        memo,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ sent: res.sent, failed: res.failed });
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <span
        title={disabledReason}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Send className="h-3.5 w-3.5" aria-hidden />
        섭외 진행
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
        <Button size="sm">
          <Send className="mr-1.5 h-3.5 w-3.5" />
          섭외 진행
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            이 프로젝트의 모든 전문가에게 섭외 요청을 보낼까요?
          </DialogTitle>
          <DialogDescription>
            배정된 <strong>{targetCount}명</strong>에게 동의 링크가 담긴 요청이
            나갑니다. 보낸 뒤에는 되돌릴 수 없습니다.
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
                <strong>{result.sent}명</strong>에게 섭외 요청을 보냈습니다.
                전문가가 수락하면 이 화면의 상태가 자동으로 바뀝니다.
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
                      <li key={f.code} className="text-xs">
                        · <span className="font-mono">{f.code}</span> — {f.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs">
                    실패한 자리는 배정 상태로 남아 있습니다. 원인을 고친 뒤 해당
                    코드넘버에서 개별로 보내시면 됩니다.
                  </p>
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
              <legend className="text-sm font-semibold">발송 방식</legend>
              {CHANNELS.map((c) => (
                <Label
                  key={c.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 font-normal transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/5"
                >
                  <input
                    type="radio"
                    name="channel"
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
              <Label htmlFor="dispatch-deadline">회신 마감일시</Label>
              <Input
                id="dispatch-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                비워 두면 기본 기한이 적용됩니다. 이 시각이 지나면 동의 링크가
                만료되고 자리가 다시 열립니다.
              </p>
            </div>

            <div className="space-y-2">
              <div>
                <Label htmlFor="dispatch-program">사업명 / 프로그램명</Label>
                <Input
                  id="dispatch-program"
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dispatch-summary">주제 / 행사 내용 (선택)</Label>
                <Textarea
                  id="dispatch-summary"
                  rows={2}
                  value={eventSummary}
                  onChange={(e) => setEventSummary(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dispatch-memo">공통 안내 메모 (선택)</Label>
                <Textarea
                  id="dispatch-memo"
                  rows={3}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="주차 안내, 준비물, 사전 협의 내용 등 — 전원에게 같은 내용으로 전달됩니다."
                />
              </div>
            </div>

            <p className="rounded-md bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
              일정·역할·의뢰비용·장소는 세션에서 사람마다 자동으로 채워집니다.
              여기 적는 내용은 전원에게 같게 나갑니다.
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                아니오
              </Button>
              <Button className="flex-1" onClick={send} disabled={pending}>
                <Send className="mr-1.5 h-4 w-4" />
                {pending ? "발송 중…" : `예, ${targetCount}명에게 보냅니다`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
