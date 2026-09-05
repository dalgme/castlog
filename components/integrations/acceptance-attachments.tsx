"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, ChevronDown, ExternalLink, Paperclip } from "lucide-react";

import type { AcceptanceAttachmentView } from "@/lib/integrations/acceptance-view";

/**
 * 수락서 동봉 자료.
 *
 * PDF·이미지는 이 자리에서 인라인으로 펼쳐 본다. 엑셀·한글·파워포인트 등
 * 브라우저가 그릴 수 없는 형식(기획 지시 2026-09-05 — 첨부 형식 확대)은
 * '원본 열기'로 서명 만료 URL을 새 창에서 연다 — 민감서류를 외부 변환
 * 서비스에 보내지 않는다는 원칙(document-preview와 동일)을 지킨다.
 * 열람 주소는 만료되는 서명 URL이며 공개 URL을 만들지 않는다.
 */
export function AcceptanceAttachments({
  attachments,
}: {
  attachments: AcceptanceAttachmentView[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        첨부 자료 <span className="font-normal">(화면 열람 전용)</span>
      </p>
      <ul className="space-y-2">
        {attachments.map((file) => {
          const isOpen = openId === file.id;
          const ext = file.fileName.toLowerCase().split(".").pop() ?? "";
          const isPdf =
            file.mimeType === "application/pdf" || ext === "pdf";
          const isImage =
            (file.mimeType ?? "").startsWith("image/") ||
            ["jpg", "jpeg", "png", "gif"].includes(ext);
          const inline = isPdf || isImage;

          if (!inline) {
            // 오피스·한글 — 브라우저가 못 그린다. 새 창(만료 URL)으로 연다
            return (
              <li key={file.id} className="rounded-md border">
                <div className="flex w-full items-center gap-2 px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                  {file.url ? (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline"
                    >
                      원본 열기
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      열람 불가
                    </span>
                  )}
                </div>
              </li>
            );
          }

          return (
            <li key={file.id} className="rounded-md border">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : file.id)}
                disabled={!file.url}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-60"
              >
                {isPdf ? (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                {file.url ? (
                  <ChevronDown
                    className={
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                      (isOpen ? "rotate-180" : "")
                    }
                  />
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    열람 불가
                  </span>
                )}
              </button>

              {isOpen && file.url && (
                <div className="border-t bg-secondary/30 p-2">
                  {isImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={file.url}
                      alt={file.fileName}
                      className="mx-auto max-h-[70vh] w-auto max-w-full rounded object-contain"
                    />
                  ) : isPdf ? (
                    <object
                      data={`${file.url}#toolbar=0&navpanes=0`}
                      type="application/pdf"
                      className="h-[70vh] w-full rounded"
                      aria-label={file.fileName}
                    >
                      <p className="p-3 text-sm text-muted-foreground">
                        이 브라우저에서는 PDF를 화면에 표시할 수 없습니다. 다른
                        브라우저에서 확인해 주세요.
                      </p>
                    </object>
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">
                      화면에서 열 수 없는 형식입니다.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        PDF·이미지는 화면에서 바로 펼쳐 보고, 엑셀·한글·파워포인트는 ‘원본 열기’로
        엽니다. 열람 주소는 일정 시간이 지나면 만료되므로, 만료 후에는 화면을
        새로고침해 주세요.
      </p>
    </div>
  );
}
