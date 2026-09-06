"use client";

import { useState, useTransition } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CHECKLIST_LOG_ACTION_LABELS,
  type ChecklistLogRow,
} from "@/lib/checklists/kinds";

/**
 * 체크리스트 변경 로그 — 언제·누가·어떤 항목을 추가/수정/삭제했는지
 * (기획 11·13·15). 표준시트와 프로젝트 시트가 같은 표시를 쓴다.
 */
export function ChecklistLogsDialog({
  title,
  load,
}: {
  title: string;
  load: () => Promise<{ ok: true; rows: ChecklistLogRow[] } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<ChecklistLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          startTransition(async () => {
            const r = await load();
            if (r.ok) setRows(r.rows);
            else setError(r.error);
          });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
          <History className="mr-1 h-3.5 w-3.5" aria-hidden />
          변경 로그
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title} — 변경 로그</DialogTitle>
          <DialogDescription>최근 300건. 항목·필드·이전 값·바뀐 값을 담당자별로 남깁니다.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {pending && !rows && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">아직 변경 기록이 없습니다.</p>
        )}
        {rows && rows.length > 0 && (
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">일시</th>
                  <th className="py-1 pr-2 font-medium">담당자</th>
                  <th className="py-1 pr-2 font-medium">행위</th>
                  <th className="py-1 pr-2 font-medium">항목 · 필드</th>
                  <th className="py-1 pr-2 font-medium">이전 → 이후</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-muted-foreground">
                      {new Date(r.at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2">{r.actorName ?? "-"}</td>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      {CHECKLIST_LOG_ACTION_LABELS[r.action] ?? r.action}
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.itemTitle && <span className="block">{r.itemTitle}</span>}
                      {r.field && <span className="text-muted-foreground">{r.field}</span>}
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.before || r.after ? (
                        <>
                          <span className="text-muted-foreground line-through">{r.before ?? "(없음)"}</span>
                          {" → "}
                          <span>{r.after ?? "(없음)"}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
