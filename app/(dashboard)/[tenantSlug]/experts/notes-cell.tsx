"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import {
  addExpertNote,
  getExpertNotes,
  type ExpertNoteRow,
} from "./profile-actions";

/**
 * 전문가 메모 셀 (기획 확정 2026-08-23) — 회사 내부 메모 스레드.
 * 기존 기록이 댓글처럼 (내용 + 작성자·일시) 쌓여 보이고, 하단 입력폼으로
 * 추가한다. 수정·삭제 없이 추가 전용 — 기록 성격. 전문가 본인 비노출.
 */
export function ExpertNotesCell({
  expertId,
  expertName,
  count,
  canManage,
}: {
  expertId: string;
  expertName: string;
  count: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<ExpertNoteRow[] | null>(null);
  const [draft, setDraft] = useState("");

  function load() {
    void getExpertNotes(expertId).then((r) => {
      if (r.ok) setRows(r.rows);
      else toast({ variant: "destructive", description: r.error });
    });
  }

  function openDialog() {
    setOpen(true);
    setRows(null);
    setDraft("");
    load();
  }

  function submit() {
    const body = draft.trim();
    if (!body) {
      toast({ variant: "destructive", description: "메모 내용을 입력하세요." });
      return;
    }
    startTransition(async () => {
      const r = await addExpertNote(expertId, body);
      if (r.ok) {
        setDraft("");
        load();
        router.refresh();
      } else {
        toast({ variant: "destructive", description: r.error });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-secondary"
        title="회사 내부 메모 — 작성자·일시가 남는 댓글식 기록"
      >
        <MessageSquareText className="h-3.5 w-3.5 text-brand" aria-hidden />
        메모{count > 0 ? ` ${count}` : ""}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>메모 — {expertName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            우리 회사 내부 기록입니다 — 전문가 본인·다른 회사에는 보이지
            않습니다. 남긴 메모는 수정·삭제되지 않고 그대로 쌓입니다.
          </p>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {rows === null ? (
              <p className="text-xs text-muted-foreground">불러오는 중...</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 메모가 없습니다. 첫 메모를 남겨 보세요.
              </p>
            ) : (
              rows.map((note) => (
                <div key={note.id} className="rounded-lg bg-secondary/60 p-2.5">
                  <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {note.authorName} ·{" "}
                    {new Date(note.createdAt).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </p>
                </div>
              ))
            )}
          </div>

          {canManage && (
            <div className="space-y-2 border-t pt-3">
              <Textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="메모 입력 (작성자·일시가 함께 기록됩니다)"
                maxLength={2000}
              />
              <Button size="sm" onClick={submit} disabled={pending}>
                {pending ? "저장 중..." : "메모 추가"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
