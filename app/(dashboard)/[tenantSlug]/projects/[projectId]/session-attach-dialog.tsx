"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Paperclip, Trash2, UploadCloud, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  deleteSessionPaymentAttachment,
  getSessionPaymentAttachmentUrl,
  uploadSessionPaymentAttachments,
} from "./session-attachment-actions";

export type SessionAttachment = {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  createdAt: string;
  uploaderName: string | null;
};

function fmtSize(n: number | null): string {
  if (n === null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 세션별 파일 첨부 팝업 (기획 지시 2026-09-21) — 드래그로 여러 파일을 한 번에 올린다.
 * 파일은 PDF·이미지·오피스·한글, 10MB 이하, 한 번에 20개까지.
 */
export function SessionAttachDialog({
  projectId,
  slotId,
  sessionLabel,
  attachments,
  canManage,
}: {
  projectId: string;
  slotId: string;
  sessionLabel: string;
  attachments: SessionAttachment[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.size > 0);
    setQueue((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))].slice(0, 20);
    });
  }

  function upload() {
    if (queue.length === 0) return;
    setError(null);
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("slotId", slotId);
    for (const f of queue) {
      formData.append("files", f);
      formData.append("fileNames", f.name); // 한글 파일명 보전
    }
    startTransition(async () => {
      const r = await uploadSessionPaymentAttachments(formData);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setQueue([]);
      if (r.failed.length > 0) {
        setError(`올리지 못한 파일 ${r.failed.length}개: ${r.failed.map((f) => `${f.name} (${f.error})`).join(" / ")}`);
      }
      if (r.uploaded > 0) toast({ description: `파일 ${r.uploaded}개를 첨부했습니다.` });
      router.refresh();
    });
  }

  function view(id: string) {
    const win = window.open("", "_blank", "noopener");
    startTransition(async () => {
      const r = await getSessionPaymentAttachmentUrl(id);
      if (!r.ok) {
        win?.close();
        setError(r.error);
      } else if (win) {
        win.location.href = r.url;
      } else {
        setError("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.");
      }
    });
  }

  function remove(a: SessionAttachment) {
    if (!window.confirm(`첨부 파일(${a.fileName})을 삭제할까요?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteSessionPaymentAttachment(a.id);
      if (!r.ok) setError(r.error);
      else {
        toast({ description: "삭제했습니다." });
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn(
          "h-7 px-2 text-[11px]",
          attachments.length > 0 ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50" : "border-brand text-brand hover:bg-brand/10"
        )}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        title="세션 증빙 파일 첨부 — 여러 파일을 한 번에 드래그해서 올릴 수 있습니다"
      >
        <Paperclip className="mr-0.5 h-3 w-3" aria-hidden />
        파일 첨부{attachments.length > 0 ? ` (${attachments.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !v && !pending && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>파일 첨부 — {sessionLabel}</DialogTitle>
            <DialogDescription>
              결과보고서·강의확인서·사진 등 이 세션의 지급 증빙을 올립니다. 여러 파일을 한 번에 끌어다 놓을 수
              있습니다 (PDF·이미지·오피스·한글, 파일당 10MB, 한 번에 20개).
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="whitespace-pre-wrap text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {canManage && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
                dragging ? "border-brand bg-brand/10 text-brand" : "border-neutral-300 text-muted-foreground hover:border-brand hover:bg-brand/5"
              )}
            >
              <UploadCloud className="h-7 w-7" aria-hidden />
              <span className="font-semibold">여기에 파일을 끌어다 놓거나 클릭해서 고르세요</span>
              <span className="text-xs">여러 파일 동시 선택 가능</span>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {queue.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">올릴 파일 ({queue.length})</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {queue.map((f) => (
                  <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-2 rounded border bg-amber-50/50 px-2 py-1 text-xs">
                    <span className="truncate">
                      {f.name} <span className="text-muted-foreground">{fmtSize(f.size)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label="목록에서 빼기"
                      className="rounded p-0.5 text-muted-foreground hover:text-red-600"
                      onClick={() => setQueue((prev) => prev.filter((x) => x !== f))}
                      disabled={pending}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" className="w-full" onClick={upload} disabled={pending}>
                <FileUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                {pending ? "올리는 중…" : `${queue.length}개 파일 올리기`}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold">첨부된 파일 ({attachments.length})</p>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">아직 첨부된 파일이 없습니다.</p>
            ) : (
              <ul className="max-h-48 divide-y overflow-y-auto rounded border">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left underline underline-offset-2 hover:text-brand"
                      onClick={() => view(a.id)}
                      disabled={pending}
                      title="열람 (서명 링크, 감사 기록)"
                    >
                      {a.fileName}
                    </button>
                    <span className="shrink-0 text-muted-foreground">
                      {fmtSize(a.sizeBytes)}
                      {a.uploaderName ? ` · ${a.uploaderName}` : ""}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        aria-label="삭제"
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-600"
                        onClick={() => remove(a)}
                        disabled={pending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
