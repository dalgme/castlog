"use client";

import { useEffect, useRef, useState } from "react";

import { documentPreviewKind } from "@/lib/experts/documents";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * 서류 웹 미리보기 (기획 확정 2026-08-22)
 *
 * 형식별 렌더링:
 *  - 이미지/PDF: 브라우저 내장
 *  - xls/xlsx: SheetJS로 표 렌더링 (클라이언트)
 *  - docx: docx-preview로 렌더링 (클라이언트)
 *  - ppt/pptx/hwp/hwpx/doc(구형): 브라우저에서 신뢰할 수 있는 렌더러가 없다 —
 *    민감서류를 외부 변환 서비스에 보낼 수 없으므로(보안 원칙) '원본 열기'로
 *    안내한다. 파일 자체는 정상 저장·열람된다.
 *
 * url은 60초 만료 서명 URL — 진입 즉시 로드하고, 만료되면 새로고침을 안내한다.
 */
export function DocumentPreview({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const kind = documentPreviewKind(fileName);
  const [error, setError] = useState<string | null>(null);
  const [sheetHtml, setSheetHtml] = useState<string[] | null>(null);
  const docxRef = useRef<HTMLDivElement>(null);
  const [docxDone, setDocxDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderSheet() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const parts = workbook.SheetNames.slice(0, 5).map((name) => {
          const sheet = workbook.Sheets[name];
          return sheet ? XLSX.utils.sheet_to_html(sheet) : "";
        });
        if (!cancelled) setSheetHtml(parts);
      } catch {
        if (!cancelled) {
          setError(
            "미리보기 로드에 실패했습니다. 열람 링크가 만료되었을 수 있으니 새로고침해 주세요."
          );
        }
      }
    }

    async function renderDocx() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        const { renderAsync } = await import("docx-preview");
        if (!cancelled && docxRef.current) {
          await renderAsync(buffer, docxRef.current, undefined, {
            inWrapper: true,
            ignoreLastRenderedPageBreak: true,
          });
          setDocxDone(true);
        }
      } catch {
        if (!cancelled) {
          setError(
            "미리보기 로드에 실패했습니다. 열람 링크가 만료되었을 수 있으니 새로고침해 주세요."
          );
        }
      }
    }

    if (kind === "sheet") void renderSheet();
    if (kind === "docx") void renderDocx();
    return () => {
      cancelled = true;
    };
  }, [url, kind]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 만료 서명 URL은 next/image 최적화 대상이 아니다
      <img
        src={url}
        alt={fileName}
        className="max-h-[80vh] w-auto max-w-full rounded-md border"
      />
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        src={url}
        title={fileName}
        className="h-[80vh] w-full rounded-md border bg-white"
      />
    );
  }

  if (kind === "sheet") {
    return sheetHtml ? (
      <div className="space-y-4">
        {sheetHtml.map((html, i) => (
          <div
            key={i}
            className="overflow-x-auto rounded-md border bg-white p-3 text-sm [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">미리보기를 불러오는 중...</p>
    );
  }

  if (kind === "docx") {
    return (
      <div>
        {!docxDone && (
          <p className="text-sm text-muted-foreground">미리보기를 불러오는 중...</p>
        )}
        <div ref={docxRef} className="overflow-x-auto rounded-md border bg-white" />
      </div>
    );
  }

  return (
    <Alert>
      <AlertDescription>
        이 형식(ppt/pptx/hwp/hwpx/doc)은 브라우저에서 바로 렌더링할 수 없습니다.
        민감 서류를 외부 변환 서비스에 보내지 않는 보안 원칙에 따라, 아래
        ‘원본 열기’로 내려받아 확인해 주세요. PDF로 변환해 올리면 웹에서 바로
        보입니다.
      </AlertDescription>
    </Alert>
  );
}
