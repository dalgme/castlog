"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DOCUMENT_ACCEPT_ATTR } from "@/lib/experts/documents";
import {
  BULK_DOC_TYPES,
  BULK_DOC_TYPE_LABELS,
  isBulkDocType,
} from "@/lib/experts/document-import";
import {
  analyzeDocumentImport,
  uploadBulkExpertDocument,
  type DocImportCandidate,
  type DocImportRow,
} from "./document-actions";

/**
 * 파일 일괄 등록 (기획 확정 2026-08-23).
 * ① 파일 여러 개 선택 → ② 파일명 자동 매칭 미리보기(전문가·유형 보정) →
 * ③ 확정 업로드(파일별 순차). 통합서류(혼합)는 가장 민감한 서류 기준으로
 * 보호된다. 전문가 본인이 이미 올린 유형은 업로드가 취소된다.
 */

type PreviewRow = DocImportRow & { file: File; skip: boolean };

export function DocumentImportClient() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [roster, setRoster] = useState<DocImportCandidate[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);

  function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await analyzeDocumentImport(files.map((f) => f.name));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRoster(result.experts);
      setRows(
        result.rows.map((r, i) => ({
          ...r,
          file: files[i]!,
          skip: Boolean(r.warning && r.warning.includes("취소")),
        }))
      );
    });
  }

  function patchRow(index: number, patch: Partial<PreviewRow>) {
    setRows((prev) =>
      prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev
    );
  }

  const readyCount = (rows ?? []).filter((r) => !r.skip && r.expertId).length;

  function commit() {
    if (!rows) return;
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const results: string[] = [];
      let done = 0;
      for (const row of rows) {
        if (row.skip || !row.expertId) {
          if (!row.skip) results.push(`⚠️ ${row.fileName}: 전문가 미지정 — 건너뜀`);
          else results.push(`⏭️ ${row.fileName}: 취소(${row.warning ?? "제외"})`);
          continue;
        }
        done += 1;
        setProgress(`${done}/${readyCount} 업로드 중 — ${row.fileName}`);
        const formData = new FormData();
        formData.set("expertId", row.expertId);
        formData.set("docType", row.docType);
        formData.set("fileName", row.fileName);
        formData.set("file", row.file);
        const result = await uploadBulkExpertDocument(formData);
        if (result.ok) {
          results.push(
            `✅ ${row.fileName} → ${row.expertName} · ${BULK_DOC_TYPE_LABELS[row.docType]}${
              result.replaced ? " (자사 기존 파일 교체)" : ""
            }`
          );
        } else {
          results.push(`❌ ${row.fileName}: ${result.error}`);
        }
      }
      setProgress(null);
      setSummary(results);
      setRows(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <Card className="border-2 border-sky-300">
      <CardHeader className="bg-sky-50/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-sky-900">
          <FileUp className="h-4 w-4" aria-hidden />
          3. 파일 일괄 등록 (보유 서류)
        </CardTitle>
        <p className="pt-1 text-xs leading-relaxed text-sky-900/80">
          기업이 보관해 온 전문가 서류(이력서·신분증사본·통장사본)를 한 번에
          올립니다. 파일명 속 <b>휴대폰 뒷 4자리 또는 이름</b>으로 전문가를 자동
          매칭하고, 파일명 키워드(이력/신분/통장)로 유형을 추정합니다 — 표에서
          바로 고칠 수 있습니다. 여러 서류가 한 파일에 섞였으면{" "}
          <b>통합서류(혼합)</b>로 등록되며 가장 민감한 서류 기준으로 보호됩니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT_ATTR}
          onChange={(e) => onFilesPicked(e.target.files)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-sky-700"
        />
        <p className="text-xs text-muted-foreground">
          예: <code>홍길동_이력서.pdf</code>, <code>김철수_5678_통장.jpg</code>,{" "}
          <code>박영희_제출서류.pdf</code>(통합). PDF·이미지·오피스·한글, 파일당
          10MB, 한 번에 200개까지.
        </p>

        {pending && rows === null && !progress && (
          <p className="text-sm text-muted-foreground">파일명을 분석하는 중...</p>
        )}
        {progress && <p className="text-sm font-medium text-sky-800">{progress}</p>}

        {rows && (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>파일명</TableHead>
                    <TableHead>전문가</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead>상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row.skip ? "opacity-50" : ""}>
                      <TableCell className="max-w-[220px] truncate text-xs">
                        {row.fileName}
                      </TableCell>
                      <TableCell>
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={row.expertId ?? ""}
                          onChange={(e) => {
                            const id = e.target.value || null;
                            const hit = roster.find((r) => r.id === id);
                            patchRow(i, {
                              expertId: id,
                              expertName: hit?.name ?? null,
                              skip: false,
                              warning: null,
                            });
                          }}
                        >
                          <option value="">— 전문가 선택 —</option>
                          {(row.candidates.length > 0 ? row.candidates : roster).map(
                            (c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} (…{c.phoneTail})
                              </option>
                            )
                          )}
                          {row.candidates.length > 0 && (
                            <optgroup label="전체 전문가">
                              {roster.map((c) => (
                                <option key={`all-${c.id}`} value={c.id}>
                                  {c.name} (…{c.phoneTail})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </TableCell>
                      <TableCell>
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={row.docType}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (isBulkDocType(v)) patchRow(i, { docType: v });
                          }}
                        >
                          {BULK_DOC_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {BULK_DOC_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.warning ? (
                          <span className="text-amber-700">{row.warning}</span>
                        ) : row.expertId ? (
                          <Badge variant="default">준비됨</Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            전문가를 선택하세요
                          </span>
                        )}
                        {!row.skip && row.warning?.includes("취소") && (
                          <span className="ml-1 text-muted-foreground">(제외됨)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={commit}
                disabled={pending || readyCount === 0}
                className="bg-sky-600 text-white hover:bg-sky-700"
              >
                <Upload className="mr-1 h-4 w-4" aria-hidden />
                확정 업로드 ({readyCount}건)
              </Button>
              <Button variant="ghost" onClick={() => setRows(null)} disabled={pending}>
                취소
              </Button>
            </div>
          </>
        )}

        {summary && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-sm font-semibold">업로드 결과</p>
            <ul className="space-y-0.5 text-xs">
              {summary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          올린 서류는 자사에서 바로 열람할 수 있고, 타 기업에는 전문가가 열람을
          허용하거나 섭외를 승인해야 보입니다. 전문가 본인이 이미 올린 유형은
          권한없음(이미 전문가가 등록)으로 취소됩니다. 전체 결과는 아래{" "}
          <b>파일 등록 현황</b> 표에 누적 반영됩니다.
        </p>
      </CardContent>
    </Card>
  );
}
