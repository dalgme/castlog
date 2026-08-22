"use client";

import { useMemo, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { sendMessage } from "./actions";

export type RecipientOption = {
  expertId: string;
  name: string;
  phone: string;
  email: string | null;
  smsAdConsented: boolean;
};

/**
 * 발송 작성 폼 (CLAUDE.md 5-1 — 유형 선택 필수, 기본값 광고성=안전한 쪽)
 * 광고성 선택 시 (광고) 표기·수신거부 링크가 강제 삽입됨을 미리보기로 보여준다.
 */
export type SenderOption = { value: string; label: string };

export function ComposeForm({
  recipients,
  senderOptions = [],
  defaultSender = null,
}: {
  recipients: RecipientOption[];
  /** 발신번호 선택지 (대표번호 + 추가 등록 번호) */
  senderOptions?: SenderOption[];
  /** 기본 발신번호 — 로그인 직원 본인 번호가 등록돼 있으면 그 번호 (기획 2026-08-22) */
  defaultSender?: string | null;
}) {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [senderNumber, setSenderNumber] = useState<string>(defaultSender ?? "");
  // 기본값은 업무연락 (기획 변경 2026-08-22). 실제 발송의 대부분이 섭외·일정·
  // 지급 안내라 광고성 기본은 매번 바꾸는 클릭만 만들었다. 광고성을 고르면
  // 강제장치(미동의 제외·(광고) 표기·수신거부 링크·야간 차단)는 그대로 작동한다.
  const [messageType, setMessageType] = useState<"advertising" | "transactional">(
    "transactional"
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const eligible = useMemo(
    () =>
      channel === "email" ? recipients.filter((r) => r.email !== null) : recipients,
    [channel, recipients]
  );
  const selectedCount = eligible.filter((r) => selected.has(r.expertId)).length;

  const preview =
    messageType === "advertising"
      ? `(광고) ${body || "…"}\n무료수신거부: https://castlog.kr/u/****`
      : body || "…";

  function toggle(expertId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(expertId);
      else next.delete(expertId);
      return next;
    });
  }

  function onSend() {
    const ids = eligible
      .filter((r) => selected.has(r.expertId))
      .map((r) => r.expertId);
    if (ids.length === 0) {
      toast({ variant: "destructive", description: "수신 대상을 선택하세요." });
      return;
    }
    // 위험 작업 2단계 확인 (CLAUDE.md 14-3)
    const typeLabel = messageType === "advertising" ? "광고성" : "업무연락";
    if (
      !window.confirm(
        `${typeLabel} ${channel.toUpperCase()} ${ids.length}명에게 발송할까요?\n발송 후 취소할 수 없습니다.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await sendMessage({
        channel,
        messageType,
        subject: subject || undefined,
        body,
        expertIds: ids,
        senderNumber:
          channel === "sms" && senderNumber ? senderNumber : undefined,
      });
      if (result.ok) {
        toast({
          description: `발송 완료 — 성공 ${result.sent}건, 실패 ${result.failed}건, 제외 ${result.excluded}건${result.testMode ? " (테스트 모드)" : ""}`,
        });
        setBody("");
        setSelected(new Set());
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["sms", "email"] as const).map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={channel === c ? "default" : "outline"}
            onClick={() => setChannel(c)}
          >
            {c === "sms" ? "문자(SMS)" : "이메일"}
          </Button>
        ))}
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-semibold">발송 유형 (필수)</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            checked={messageType === "advertising"}
            onChange={() => setMessageType("advertising")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">광고성</span>
            <span className="block text-xs text-muted-foreground">
              신규 기회 홍보·소식 등. 미동의자 자동 제외, (광고) 표기와
              수신거부 링크 자동 삽입, 야간(21~08시) 발송 차단.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            checked={messageType === "transactional"}
            onChange={() => setMessageType("transactional")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">업무연락</span>
            <span className="block text-xs text-muted-foreground">
              섭외 요청·서류 요청·일정·지급 안내 등 계약 이행 관련 연락 (사전
              동의 불요). 홍보 내용을 담으면 안 됩니다.
            </span>
          </span>
        </label>
      </div>

      {channel === "sms" && senderOptions.length > 0 && (
        <div className="space-y-1 rounded-md border p-3">
          <p className="text-sm font-semibold">발신번호</p>
          <select
            value={senderNumber}
            onChange={(e) => setSenderNumber(e.target.value)}
            className="h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm"
          >
            {senderOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.value === defaultSender ? " — 기본" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            본인 휴대폰과 일치하는 등록 번호가 기본 선택됩니다. 발신번호
            추가·삭제는 설정 &gt; SMS 설정 &gt; 발신번호 관리에서 합니다.
          </p>
        </div>
      )}

      {channel === "email" && (
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="이메일 제목"
          maxLength={150}
        />
      )}

      <Textarea
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="발송 내용을 입력하세요."
        maxLength={1800}
      />

      <div className="rounded-md bg-secondary/60 p-3">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          미리보기 (실제 발송 형식)
        </p>
        <p className="whitespace-pre-wrap text-sm">{preview}</p>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            수신 대상 ({selectedCount}/{eligible.length})
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelected(
                selectedCount === eligible.length
                  ? new Set()
                  : new Set(eligible.map((r) => r.expertId))
              )
            }
          >
            {selectedCount === eligible.length ? "전체 해제" : "전체 선택"}
          </Button>
        </div>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {channel === "email"
              ? "이메일이 등록된 연결 전문가가 없습니다."
              : "연결된 전문가가 없습니다."}
          </p>
        ) : (
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {eligible.map((recipient) => (
              <li key={recipient.expertId}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/60">
                  <Checkbox
                    checked={selected.has(recipient.expertId)}
                    onCheckedChange={(checked) =>
                      toggle(recipient.expertId, checked === true)
                    }
                  />
                  <span className="font-medium">{recipient.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {channel === "sms" ? recipient.phone : recipient.email}
                  </span>
                  {messageType === "advertising" && channel === "sms" && (
                    <Badge
                      variant={recipient.smsAdConsented ? "secondary" : "destructive"}
                      className="ml-auto text-[10px]"
                    >
                      {recipient.smsAdConsented ? "광고 동의" : "미동의(자동 제외)"}
                    </Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {messageType === "advertising" && (
        <Alert>
          <AlertDescription>
            광고성 발송은 수신동의자에게만 전송되며, 미동의자는 선택되어 있어도
            서버에서 자동 제외됩니다. 위법 발송은 발송 주체가 책임을 집니다.
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={pending || selectedCount === 0 || body.length === 0}
        onClick={onSend}
      >
        {pending ? "발송 중..." : `발송 (${selectedCount}명)`}
      </Button>
    </div>
  );
}
