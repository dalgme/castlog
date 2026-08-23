"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { cancelScheduledMessage } from "./actions";

export type SendBatchRow = {
  id: string;
  title: string;
  messageType: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  excludedCount: number;
  lastError: string | null;
  senderName: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "예약됨", cls: "bg-amber-100 text-amber-800" },
  sending: { label: "발송 중", cls: "bg-blue-100 text-blue-800" },
  sent: { label: "발송 완료", cls: "bg-emerald-100 text-emerald-800" },
  canceled: { label: "취소됨", cls: "bg-gray-100 text-gray-600" },
  failed: { label: "실패", cls: "bg-red-100 text-red-700" },
};

function formatKst(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 문자 발송 이력 (기획 확정 2026-08-23) — 발송 건 단위: 제목·유형·상태·결과.
 * 예약 건은 발송 전까지 여기서 취소할 수 있다 (CLAUDE.md 14-5).
 */
export function SendHistory({ rows }: { rows: SendBatchRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function onCancel(row: SendBatchRow) {
    if (
      !window.confirm(
        `예약 발송 '${row.title}' (${row.recipientCount}명)을 취소할까요?`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await cancelScheduledMessage(row.id);
      if (r.ok) {
        toast({ description: "예약이 취소되었습니다." });
        router.refresh();
      } else {
        toast({ variant: "destructive", description: r.error });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        발송 이력이 없습니다. 발송하거나 예약하면 여기에 제목별로 쌓입니다.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const meta = STATUS_META[row.status] ?? {
          label: row.status,
          cls: "bg-gray-100 text-gray-600",
        };
        return (
          <li key={row.id} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}
              >
                {meta.label}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {row.messageType === "advertising" ? "광고" : "업무"}
              </Badge>
              <button
                type="button"
                className="font-medium text-brand-navy underline-offset-4 hover:underline"
                onClick={() =>
                  setExpandedId(expandedId === row.id ? null : row.id)
                }
              >
                {row.title}
              </button>
              <span className="text-xs text-muted-foreground">
                {row.recipientCount}명
              </span>
              {row.status === "sent" && (
                <span className="text-xs text-muted-foreground">
                  성공 {row.sentCount} · 실패 {row.failedCount}
                  {row.excludedCount > 0 ? ` · 제외 ${row.excludedCount}` : ""}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {row.status === "scheduled" ? (
                  <>
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    {formatKst(row.scheduledAt)} 예정
                  </>
                ) : (
                  formatKst(row.sentAt ?? row.createdAt)
                )}
              </span>
              {row.status === "scheduled" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-600 hover:text-red-700"
                  disabled={pending}
                  onClick={() => onCancel(row)}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                  예약 취소
                </Button>
              )}
            </div>
            {row.status === "failed" && row.lastError && (
              <p className="mt-1 text-xs text-destructive">사유: {row.lastError}</p>
            )}
            {expandedId === row.id && (
              <p className="mt-1.5 rounded bg-secondary/50 p-2 text-xs text-muted-foreground">
                {row.senderName ? `보낸 사람: ${row.senderName} · ` : ""}
                등록 {formatKst(row.createdAt)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
