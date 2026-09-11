"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, MailPlus } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResetEmailResult, TempPasswordResult } from "@/lib/admin/password-support";

/**
 * 계정 한 개의 비밀번호 지원 — 재설정 메일(권장) · 임시 비밀번호(예비).
 *
 * 관리모드(플랫폼)와 임직원 관리(기업)가 같은 화면을 쓴다. 누가 누구에게 할 수
 * 있는지는 넘겨받는 서버 액션이 판정하고, 여기는 결과를 보여 주기만 한다.
 *
 * 임시 비밀번호는 되돌릴 수 없는 조치(기존 비밀번호가 즉시 무효)라 한 번 되묻고
 * (§14-3), 발급 결과는 창을 닫으면 다시 볼 수 없다 — 저장하지 않기 때문이다.
 */
export function PasswordSupportActions({
  userId,
  userName,
  email,
  disabled,
  compact,
  sendReset,
  issueTemp,
}: {
  userId: string;
  userName: string;
  email: string;
  disabled?: boolean;
  /** 아이콘만 (임직원 관리 표의 '관리' 칸처럼 좁은 자리) */
  compact?: boolean;
  sendReset: (userId: string) => Promise<ResetEmailResult>;
  issueTemp: (userId: string) => Promise<TempPasswordResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [mail, setMail] = useState<
    { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issued, setIssued] = useState<{ password: string } | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function sendMail() {
    setMail({ kind: "idle" });
    startTransition(async () => {
      const r = await sendReset(userId);
      setMail(r.ok ? { kind: "sent" } : { kind: "error", message: r.error });
    });
  }

  function issue() {
    setIssueError(null);
    startTransition(async () => {
      const r = await issueTemp(userId);
      if (r.ok) setIssued({ password: r.tempPassword });
      else setIssueError(r.error);
    });
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function closeDialog() {
    setConfirmOpen(false);
    setIssued(null);
    setIssueError(null);
    setCopied(false);
  }

  const iconClass = compact ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5";

  return (
    <div className={compact ? "inline-flex flex-col items-start gap-0.5" : "flex flex-col items-end gap-1"}>
      <div className="flex items-center gap-1">
        <Button
          size={compact ? "icon" : "sm"}
          variant={compact ? "ghost" : "outline"}
          className={compact ? "h-8 w-8" : undefined}
          onClick={sendMail}
          disabled={pending || disabled}
          title="본인 메일로 비밀번호 재설정 링크를 보냅니다"
          aria-label="비밀번호 재설정 메일 보내기"
        >
          <MailPlus className={iconClass} aria-hidden />
          {!compact && "재설정 메일"}
        </Button>
        <Button
          size={compact ? "icon" : "sm"}
          variant={compact ? "ghost" : "outline"}
          className={compact ? "h-8 w-8" : undefined}
          onClick={() => setConfirmOpen(true)}
          disabled={pending || disabled}
          title="무작위 임시 비밀번호를 발급합니다 (다음 로그인에서 강제 변경)"
          aria-label="임시 비밀번호 발급"
        >
          <KeyRound className={iconClass} aria-hidden />
          {!compact && "임시 비밀번호"}
        </Button>
      </div>
      {mail.kind === "sent" && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-green-700">
          <Check className="h-3 w-3" aria-hidden /> {compact ? "메일 보냄" : `${email} 로 보냈습니다`}
        </span>
      )}
      {mail.kind === "error" && (
        <span className="max-w-[16rem] text-[11px] text-destructive">{mail.message}</span>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => (o ? setConfirmOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>임시 비밀번호 발급 — {userName}</DialogTitle>
            <DialogDescription>
              {issued
                ? "아래 비밀번호는 지금 한 번만 표시됩니다. 창을 닫으면 다시 볼 수 없습니다."
                : `${email} 계정의 현재 비밀번호가 즉시 무효가 되고, 본인은 다음 로그인에서 새 비밀번호를 정해야 합니다. 본인에게 직접 전달할 수 있을 때만 발급하세요.`}
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-secondary/40 p-3">
                <code className="flex-1 select-all font-mono text-base tracking-wide">{issued.password}</code>
                <Button type="button" size="sm" variant="outline" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  <span className="ml-1">{copied ? "복사됨" : "복사"}</span>
                </Button>
              </div>
              <Alert>
                <AlertDescription className="text-xs">
                  전화 등으로 본인에게만 전달하세요. 로그인 주소에서 이 비밀번호로 들어가면 곧바로 새 비밀번호 설정 화면이 뜹니다.
                  이 발급은 감사로그에 기록되었습니다.
                </AlertDescription>
              </Alert>
              <div className="flex justify-end">
                <Button type="button" onClick={closeDialog}>닫기</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {issueError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{issueError}</AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog} disabled={pending}>
                  취소
                </Button>
                <Button type="button" onClick={issue} disabled={pending}>
                  {pending ? "발급 중…" : "발급"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
