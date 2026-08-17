"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, ChevronDown } from "lucide-react";

import type { AcceptanceAttachmentView } from "@/lib/integrations/acceptance-view";

/**
 * 수락서 동봉 자료 — **화면 안에서만** 열람한다 (기획 확정).
 *
 * 다운로드 링크·PDF 내보내기를 제공하지 않고, 선택한 첨부를 이 자리에서 인라인으로
 * 펼쳐 보여준다. 업로드는 PDF·JPG·PNG만 허용되므로 모든 첨부가 브라우저에서 렌더된다.
 * 열람 주소는 만료되는 서명 URL이며 공개 URL을 만들지 않는다.
 *
 * 주의: 화면에 그려진 이상 브라우저의 이미지 저장·인쇄까지 막을 수는 없다.
 * 여기서 막는 것은 '다운로드 경로를 제공하지 않는 것'까지다.
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
          const isPdf = file.mimeType === "application/pdf";
          const isImage = (file.mimeType ?? "").startsWith("image/");

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
        첨부 자료는 화면에서만 확인할 수 있으며 별도 내려받기를 제공하지 않습니다.
        열람 주소는 일정 시간이 지나면 만료되므로, 만료 후에는 화면을 새로고침해
        주세요.
      </p>
    </div>
  );
}
