"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DateTime24Input } from "@/components/ui/datetime24";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DeputyRequestInline } from "@/components/integrations/deputy-request-inline";
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
  defaultSummary = null,
  targetCount,
  disabled,
  disabledReason,
  expertsLite = false,
  triggerLabel = "섭외 진행",
  slotIds,
  sessionLabel = null,
  size = "sm",
}: {
  projectId: string;
  projectName: string;
  /** 세션 단위 발송 — 지정하면 그 세션만 (2026-09-05) */
  slotIds?: string[];
  /** 세션 라벨 — 대화상자 제목에 표기 */
  sessionLabel?: string | null;
  size?: "sm" | "xs";
  /** 프로젝트 설명에서 자동으로 채운다 — 발송 전 자유롭게 수정 가능 */
  defaultSummary?: string | null;
  targetCount: number;
  disabled: boolean;
  disabledReason: string;
  /** 라이트 모드 — 발송 없이 요청만 기록되므로 문구를 그에 맞게 바꾼다 */
  expertsLite?: boolean;
  /** 트리거 버튼 문구 — 섭외 진행 탭(37번)에서는 "섭외 문자 발송" */
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 부PM 게이트 거부 — 다이얼로그 안에서 바로 프로젝트 단위 승인 요청 (P2-6)
  const [needsPmApproval, setNeedsPmApproval] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    failed: { code: string; reason: string }[];
  } | null>(null);

  const [channel, setChannel] = useState<DispatchChannel>("both");
  const [deadline, setDeadline] = useState("");
  const [programName, setProgramName] = useState(projectName);
  // 프로젝트 설명에서 자동 채움 (기획 확정 2026-08-23) — 수정 가능
  const [eventSummary, setEventSummary] = useState(defaultSummary ?? "");
  const [memo, setMemo] = useState("");

  function send() {
    setError(null);
    setNeedsPmApproval(false);
    startTransition(async () => {
      const res = await dispatchProjectEngagements({
        projectId,
        channel,
        deadline: deadline || undefined,
        programName,
        eventSummary,
        memo,
        slotIds,
      });
      if (!res.ok) {
        setError(res.error);
        setNeedsPmApproval(Boolean(res.needsPmApproval));
        return;
      }
      setResult({ sent: res.sent, failed: res.failed });
      router.refresh();
    });
  }

  if (disabled) {
    // 잠긴 이유를 hover 툴팁에만 두면 터치 기기에서는 영영 못 본다 (검수 G2)
    return (
      <span className="inline-flex max-w-[240px] flex-col items-start gap-0.5">
        <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
          <Send className="h-3.5 w-3.5" aria-hidden />
          {triggerLabel}
        </span>
        <span className="text-[11px] leading-tight text-muted-foreground">
          {disabledReason}
        </span>
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
          setNeedsPmApproval(false);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className={size === "xs" ? "h-8 px-2.5 text-xs" : undefined}>
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {sessionLabel
              ? expertsLite
                ? `${sessionLabel} — 섭외 요청을 기록할까요?`
                : `${sessionLabel} — 이 세션의 전문가에게 섭외 요청을 보낼까요?`
              : expertsLite
                ? "배정된 전원의 섭외 요청을 기록할까요?"
                : "이 프로젝트의 모든 전문가에게 섭외 요청을 보낼까요?"}
          </DialogTitle>
          <DialogDescription>
            {expertsLite ? (
              <>
                라이트 모드 — 배정된 <strong>{targetCount}명</strong>의 섭외
                건이 ‘요청중’으로 기록됩니다. 문자·이메일은 나가지 않으며,
                전화 확인 후 각 후보의 ‘섭외 완료(수락서 생성)’ 버튼으로
                확정합니다.
              </>
            ) : (
              <>
                배정된 <strong>{targetCount}명</strong>에게 동의 링크가 담긴
                요청이 나갑니다. 보낸 뒤에는 되돌릴 수 없습니다.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {needsPmApproval && (
          <DeputyRequestInline
            projectId={projectId}
            actionType="engagement.request"
            targetId={null}
          />
        )}

        {result ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                {expertsLite ? (
                  <>
                    <strong>{result.sent}명</strong>의 섭외 요청을 발송 없이
                    기록했습니다. 전화 확인 후 각 후보의 ‘섭외 완료(수락서
                    생성)’ 버튼으로 확정하세요.
                  </>
                ) : (
                  <>
                    <strong>{result.sent}명</strong>에게 섭외 요청을 보냈습니다.
                    전문가가 수락하면 이 화면의 상태가 자동으로 바뀝니다.
                  </>
                )}
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
            {/* 라이트 모드 — 발송이 없으니 방식·마감을 묻지 않는다 */}
            {!expertsLite && (
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
            )}

            {!expertsLite && (
            <div>
              <Label htmlFor="dispatch-deadline">회신 마감일시</Label>
              <DateTime24Input
                id="dispatch-deadline"
                value={deadline}
                onChange={setDeadline}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                비워 두면 기본 기한이 적용됩니다. 이 시각이 지나면 동의 링크가
                만료되고 자리가 다시 열립니다.
              </p>
            </div>
            )}

            <div className="space-y-2">
              <div>
                <Label htmlFor="dispatch-program">
                  사업명 / 프로그램명{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (프로젝트에서 자동 입력 — 수정 가능)
                  </span>
                </Label>
                <Input
                  id="dispatch-program"
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dispatch-summary">
                  주제 / 행사 내용{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (프로젝트 설명에서 자동 입력 — 수정 가능)
                  </span>
                </Label>
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
                {pending
                  ? expertsLite
                    ? "기록 중…"
                    : "발송 중…"
                  : expertsLite
                    ? `예, ${targetCount}명 기록합니다`
                    : `예, ${targetCount}명에게 보냅니다`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
