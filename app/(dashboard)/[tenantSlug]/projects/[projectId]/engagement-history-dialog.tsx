"use client";

import { useState, useTransition } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getEngagementEvents,
  type EngagementEventRow,
} from "../../experts/engagement-actions";

/**
 * 섭외 이력 다이얼로그 (기획 확정 2026-08-23).
 * 후보 행의 작은 시계 버튼 — 일자/시각(24시간제)/이벤트/실행자.
 * 전문가 동의는 전문가 이름, 수동 처리·발송은 담당자 이름으로 남는다.
 */
export function EngagementHistoryDialog({
  engagementId,
  expertName,
}: {
  engagementId: string;
  expertName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<EngagementEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    startTransition(async () => {
      const result = await getEngagementEvents(engagementId);
      if (result.ok) setRows(result.rows);
      else setError(result.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="섭외 이력"
          title="섭외 이력 보기"
          className="rounded p-1 text-muted-foreground hover:text-brand"
        >
          <History className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            섭외 이력{expertName ? ` — ${expertName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {pending && rows === null && (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        )}
        {rows !== null && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            기록된 이력이 없습니다. (이력 기록 기능 도입 이전의 건일 수 있습니다)
          </p>
        )}
        {rows !== null && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("ko-KR", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                  <span className="font-medium">{r.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.actorKind === "expert"
                      ? `전문가 ${r.actorLabel}`
                      : r.actorKind === "system"
                        ? r.actorLabel
                        : `담당 ${r.actorLabel}`}
                  </span>
                </div>
                {r.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          닫기
        </Button>
      </DialogContent>
    </Dialog>
  );
}
