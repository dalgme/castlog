"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquare, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import {
  replyAsPlatform,
  setTicketStatus,
  type AdminTicket,
} from "./actions";

const STATUS_LABEL: Record<string, string> = {
  open: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

export function AdminSupportPanel({ tickets }: { tickets: AdminTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border bg-background p-8 text-center text-sm text-muted-foreground">
        접수된 전문가 문의가 없습니다.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {tickets.map((t) => (
        <AdminTicketItem key={t.id} ticket={t} />
      ))}
    </ul>
  );
}

function AdminTicketItem({ ticket }: { ticket: AdminTicket }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(ticket.status !== "resolved");
  const [reply, setReply] = useState("");

  const send = () => {
    if (!reply.trim()) return;
    startTransition(async () => {
      const r = await replyAsPlatform(ticket.id, reply);
      if (r.ok) {
        setReply("");
        router.refresh();
      }
    });
  };
  const changeStatus = (status: "open" | "in_progress" | "resolved") =>
    startTransition(async () => {
      await setTicketStatus(ticket.id, status);
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
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ticket.subject}</span>
          <span className="text-xs text-muted-foreground">{ticket.expertName}</span>
        </span>
        <Badge variant={ticket.status === "resolved" ? "secondary" : "default"}>
          {STATUS_LABEL[ticket.status]}
        </Badge>
      </button>

      {open && (
        <div className="space-y-3 border-t p-3">
          <div className="space-y-2">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={m.authorType === "platform" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                    (m.authorType === "platform" ? "bg-primary/10" : "bg-secondary")
                  }
                >
                  <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
                    {m.authorType === "platform" ? "운영팀" : ticket.expertName}
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
              placeholder="운영팀 답변 작성"
              className="flex-1"
            />
            <Button size="sm" onClick={send} disabled={pending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["open", "in_progress", "resolved"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => changeStatus(s)}
                disabled={pending || ticket.status === s}
                className={
                  "rounded-md border px-2.5 py-1 text-xs " +
                  (ticket.status === s
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {STATUS_LABEL[s]}(으)로
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
