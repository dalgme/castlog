"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";

import { useToast } from "@/hooks/use-toast";

import {
  deleteSettlementLineAttachment,
  getSettlementLineAttachmentUrl,
  uploadSettlementLineAttachment,
} from "./closing-attachment-actions";

export type SettlementAttachment = { id: string; fileName: string };

/**
 * 참여 건(전문가×세션)별 증빙 첨부 — 파일 1개, 선택 (기획 2026-08-30).
 * 만족도 행 옆에 붙는 작은 조작부다.
 */
export function ClosingAttachment({
  projectId,
  engagementId,
  attachment,
  canManage,
}: {
  projectId: string;
  engagementId: string;
  attachment: SettlementAttachment | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onPick(file: File | null) {
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("engagementId", engagementId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadSettlementLineAttachment(formData);
      if (!result.ok) setError(result.error);
      else {
        toast({ description: "증빙을 첨부했습니다." });
        router.refresh();
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function onView() {
    if (!attachment) return;
    setError(null);
    // 팝업은 클릭 콜스택 안에서 먼저 연다 — 서버 왕복 뒤 open은 Safari 등이
    // 차단한다 (리뷰 C-6). URL이 오면 그 창을 이동시킨다.
    const win = window.open("", "_blank", "noopener");
    startTransition(async () => {
      const result = await getSettlementLineAttachmentUrl(attachment.id);
      if (!result.ok) {
        win?.close();
        setError(result.error);
      } else if (win) {
        win.location.href = result.url;
      } else {
        setError("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.");
      }
    });
  }

  function onRemove() {
    if (!attachment) return;
    if (!window.confirm(`증빙 파일(${attachment.fileName})을 삭제할까요?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteSettlementLineAttachment(attachment.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {attachment ? (
        <span className="inline-flex items-center gap-1 text-xs">
          <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden />
          <button
            type="button"
            disabled={pending}
            onClick={onView}
            className="max-w-[160px] truncate underline underline-offset-2 hover:text-brand"
            title={`${attachment.fileName} — 열람 (서명 링크, 감사 기록)`}
          >
            {attachment.fileName}
          </button>
          {canManage && (
            <button
              type="button"
              aria-label="증빙 삭제"
              disabled={pending}
              onClick={onRemove}
              className="rounded p-0.5 text-muted-foreground hover:text-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ) : canManage ? (
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-brand">
          <Paperclip className="h-3 w-3" aria-hidden />
          {pending ? "업로드 중..." : "증빙 첨부 (선택)"}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx"
            disabled={pending}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : null}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
