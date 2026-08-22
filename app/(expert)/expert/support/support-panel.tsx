"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, MessageSquare, Send, CheckCircle2, Building2, LifeBuoy } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tag, type TagTone } from "@/components/expert/ui";

import {
  createTicket,
  replyTicket,
  closeTicket,
  type SupportTicket,
} from "./actions";

const STATUS: Record<string, { label: string; tone: TagTone }> = {
  open: { label: "접수", tone: "amber" },
  in_progress: { label: "처리중", tone: "blue" },
  resolved: { label: "완료", tone: "green" },
};

export function SupportPanel({ tickets }: { tickets: SupportTicket[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createTicket({ subject, body });
      if (!result.ok) setError(result.error);
      else {
        setSubject("");
        setBody("");
        setCreating(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border bg-background p-3 shadow-sm">
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <LifeBuoy className="h-4 w-4 text-brand" aria-hidden /> 운영팀(넥스트랩) 지원 채널
        </p>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> 새 문의
          </Button>
        )}
      </div>

      {creating && (
        <div className="space-y-2 rounded-xl border border-brand/30 bg-brand/[0.03] p-4 shadow-sm">
          <p className="text-sm font-bold text-brand-navy">새 문의 작성</p>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="제목 (예: 지급 내역이 보이지 않아요)"
            maxLength={120}
          />
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="문의 내용을 자세히 적어주세요."
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "등록 중..." : "문의 등록"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              취소
            </Button>
          </div>
        </div>
      )}

      {tickets.length === 0 && !creating ? (
        <div className="rounded-xl border bg-background p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-brand-navy">등록한 문의가 없습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">
            궁금한 점이 있으면 &lsquo;새 문의&rsquo;로 남겨주세요.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <TicketItem key={t.id} ticket={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketItem({ ticket }: { ticket: SupportTicket }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const status = STATUS[ticket.status] ?? { label: "접수", tone: "amber" as TagTone };

  const sendReply = () => {
    if (!reply.trim()) return;
    startTransition(async () => {
      const result = await replyTicket(ticket.id, reply);
      if (result.ok) {
        setReply("");
        router.refresh();
      }
    });
  };
  const onClose = () =>
    startTransition(async () => {
      await closeTicket(ticket.id);
      router.refresh();
    });

  return (
    <li className="rounded-xl border bg-background shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 truncate text-sm font-semibold text-brand-navy">
          {ticket.subject}
        </span>
        <Tag tone={status.tone}>{status.label}</Tag>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {new Date(ticket.updatedAt).toLocaleDateString("ko-KR")}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t p-3">
          <div className="space-y-2">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={m.authorType === "expert" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                    (m.authorType === "expert"
                      ? "bg-brand/10 text-brand-navy"
                      : "bg-secondary text-brand-navy")
                  }
                >
                  <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
                    {m.authorType === "expert" ? "나" : "운영팀"}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={ticket.status === "resolved" ? "추가 문의 남기기 (다시 접수됩니다)" : "답변 남기기"}
              className="flex-1"
            />
            <Button size="sm" onClick={sendReply} disabled={pending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {ticket.status !== "resolved" && (
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand-navy"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> 해결됨으로 표시
            </button>
          )}
        </div>
      )}
    </li>
  );
}
