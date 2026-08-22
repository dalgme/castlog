"use client";

import { useState, useTransition } from "react";
import { Check, Copy, MessageSquare, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import {
  regenerateExpertInvitation,
  sendExpertInvitationSms,
} from "./actions";
import { RevokeInvitationButton } from "./revoke-button";

/**
 * 대기중 등록 요청의 행 동작 (기획 확정 2026-08-22):
 * 회수 / 재생성(새 링크 발급·복사) / 문자 발송(문구+링크+서명, 대표번호).
 * 재생성·문자 발송 모두 링크가 회전된다 — 이전에 복사해 둔 링크는 무효.
 */
export function InvitationActions({
  invitationId,
  hasPhone,
}: {
  invitationId: string;
  hasPhone: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function regenerate() {
    startTransition(async () => {
      const r = await regenerateExpertInvitation(invitationId);
      if (r.ok) {
        setNewUrl(r.url);
        setCopied(false);
        toast({
          description: "새 링크가 발급되었습니다. 이전 링크는 더 이상 열리지 않습니다.",
        });
      } else {
        toast({ variant: "destructive", description: r.error });
      }
    });
  }

  function sendSms() {
    if (
      !window.confirm(
        "등록 요청 문자를 발송할까요?\n새 링크가 발급되어 발송되며, 이전 링크는 무효가 됩니다."
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await sendExpertInvitationSms(invitationId);
      if (r.ok) {
        setNewUrl(null);
        toast({
          description: r.testMode
            ? "테스트 모드 — 발송 이력에만 기록되었습니다."
            : "등록 요청 문자가 발송되었습니다.",
        });
      } else {
        toast({ variant: "destructive", description: r.error });
      }
    });
  }

  async function copy() {
    if (!newUrl) return;
    try {
      await navigator.clipboard.writeText(newUrl);
      setCopied(true);
    } catch {
      toast({ variant: "destructive", description: "복사에 실패했습니다. 링크를 직접 선택해 복사하세요." });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <RevokeInvitationButton invitationId={invitationId} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={regenerate}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          재생성
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !hasPhone}
          title={hasPhone ? undefined : "휴대폰 번호가 지정되지 않은 요청입니다"}
          onClick={sendSms}
        >
          <MessageSquare className="mr-1 h-3.5 w-3.5" aria-hidden />
          문자 발송
        </Button>
      </div>
      {newUrl && (
        <button
          type="button"
          onClick={copy}
          className="flex max-w-[280px] items-center gap-1 rounded border bg-secondary/50 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
          title="클릭하면 복사됩니다"
        >
          {copied ? (
            <Check className="h-3 w-3 flex-none text-brand" aria-hidden />
          ) : (
            <Copy className="h-3 w-3 flex-none" aria-hidden />
          )}
          <span className="truncate">{newUrl}</span>
        </button>
      )}
    </div>
  );
}
