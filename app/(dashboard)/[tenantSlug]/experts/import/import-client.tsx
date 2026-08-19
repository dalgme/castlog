"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Download, FileUp, Plus, Trash2 } from "lucide-react";

import {
  IMPORT_STATUS_LABEL,
  type ImportDupMode,
  type ImportPreviewRow,
} from "@/lib/experts/import";
import { formatKrMobile } from "@/lib/auth/phone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  commitExpertImport,
  parseExpertImport,
  parseExpertRowsInput,
  type CommitImportResult,
} from "./actions";

const STATUS_VARIANT: Record<
  ImportPreviewRow["status"],
  "default" | "secondary" | "destructive"
> = {
  ok: "default",
  error: "destructive",
  dup_file: "secondary",
  dup_linked: "secondary",
  dup_pending: "secondary",
};

type ManualRow = { name: string; phone: string };

/** 직접 입력 시작 줄 수 — 빈 줄은 검증에서 그냥 버려지므로 넉넉히 열어 둔다 */
const MANUAL_INITIAL_ROWS = 3;

export function ExpertImportClient({ tenantSlug }: { tenantSlug: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  // 직접 입력이 기본 — 몇 명 안 되는데 엑셀을 오가는 것이 대부분의 경우다
  const [mode, setMode] = useState<"manual" | "file">("manual");
  const [manualRows, setManualRows] = useState<ManualRow[]>(
    Array.from({ length: MANUAL_INITIAL_ROWS }, () => ({ name: "", phone: "" }))
  );
  const [dupMode, setDupMode] = useState<ImportDupMode>("skip");
  const [result, setResult] = useState<
    Extract<CommitImportResult, { ok: true }> | null
  >(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRow, setCopiedRow] = useState<number | null>(null);

  function onParse() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("엑셀 파일을 선택하세요.");
      return;
    }
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const parsed = await parseExpertImport(formData);
      if (parsed.ok) {
        setPreview(parsed.rows);
      } else {
        setPreview(null);
        setError(parsed.error);
      }
    });
  }

  function setManualCell(index: number, key: keyof ManualRow, value: string) {
    setManualRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function addRow() {
    setManualRows((rows) => [...rows, { name: "", phone: "" }]);
  }

  function removeRow(index: number) {
    setManualRows((rows) =>
      rows.length === 1 ? rows : rows.filter((_, i) => i !== index)
    );
  }

  /**
   * 엑셀에서 두 칸(이름·휴대폰)을 여러 줄 복사해 붙여넣는 경우를 받아 준다.
   * 붙여넣은 내용에 줄바꿈이나 탭이 없으면 평범한 붙여넣기이므로 건드리지 않는다.
   */
  function onPasteRows(
    e: React.ClipboardEvent<HTMLInputElement>,
    index: number
  ) {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();

    const parsed = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = "", phone = ""] = line.split(/\t|,/);
        return { name: name.trim(), phone: phone.trim() };
      });
    if (parsed.length === 0) return;

    setManualRows((rows) => {
      const next = [...rows];
      for (let i = 0; i < parsed.length; i++) {
        next[index + i] = parsed[i]!;
      }
      return next;
    });
  }

  function onParseManual() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const parsed = await parseExpertRowsInput({ rows: manualRows });
      if (parsed.ok) {
        setPreview(parsed.rows);
      } else {
        setPreview(null);
        setError(parsed.error);
      }
    });
  }

  function onCommit() {
    if (!preview) return;
    setError(null);
    const rows = preview
      .filter(
        (row) =>
          row.status === "ok" ||
          (dupMode === "reissue" && row.status === "dup_pending")
      )
      .map((row) => ({ name: row.name, phone: row.phoneInput }));
    startTransition(async () => {
      const committed = await commitExpertImport({ rows, dupMode });
      if (committed.ok) {
        setResult(committed);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setError(committed.error);
      }
    });
  }

  async function copyAll() {
    if (!result) return;
    const text = result.created
      .map((row) => `${row.name}\t${formatKrMobile(row.phone)}\t${row.url}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  async function copyRow(index: number, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedRow(index);
    setTimeout(() => setCopiedRow(null), 1500);
  }

  const counts = preview
    ? preview.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {})
    : null;
  const eligibleCount = preview
    ? preview.filter(
        (row) =>
          row.status === "ok" ||
          (dupMode === "reissue" && row.status === "dup_pending")
      ).length
    : 0;

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            등록 요청 {result.created.length}건 생성 완료
          </CardTitle>
          <CardDescription>
            전문가에게 아래 링크를 전달하세요. 링크에서 휴대폰 인증 후 본인이
            직접 등록하면 연결됩니다 (유효기간 7일).
            {result.skipped > 0 && ` 중복·오류 ${result.skipped}건은 제외되었습니다.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyAll}>
              {copiedAll ? (
                <Check className="mr-1.5 h-4 w-4" />
              ) : (
                <Copy className="mr-1.5 h-4 w-4" />
              )}
              전체 복사 (이름·휴대폰·링크)
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${tenantSlug}/experts`}>전문가 목록으로</Link>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>휴대폰</TableHead>
                  <TableHead>등록 요청 링크</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.created.map((row, index) => (
                  <TableRow key={row.url}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{formatKrMobile(row.phone)}</TableCell>
                    <TableCell className="max-w-[360px] truncate font-mono text-xs">
                      {row.url}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyRow(index, row.url)}
                      >
                        {copiedRow === index ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* 명단을 만드는 일과 검증하는 일은 한 호흡이다 — 카드를 나누면 사용자가
          '템플릿을 받아야만 하는가'로 읽는다. 한 카드 안에 두 가지 입력 수단을 둔다 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. 명단 작성 · 검증</CardTitle>
          <CardDescription>
            이름과 휴대폰만 있으면 됩니다. 행마다 등록 요청 링크(/j)가 생성되며,
            전문분야·경력 등 프로필은 전문가 본인이 등록 시 직접 입력합니다.
            검증 단계에서는 아무것도 등록되지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-1 border-b">
            {(
              [
                ["manual", "직접 입력"],
                ["file", "엑셀 업로드"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError(null);
                }}
                aria-current={mode === key ? "true" : undefined}
                className={
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                  (mode === key
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-brand")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "manual" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_1.2fr_auto] items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>이름</span>
                <span>휴대폰</span>
                <span className="w-8" />
              </div>
              {manualRows.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1.2fr_auto] items-center gap-2"
                >
                  <Input
                    value={row.name}
                    placeholder="홍길동"
                    onChange={(e) => setManualCell(index, "name", e.target.value)}
                    onPaste={(e) => onPasteRows(e, index)}
                  />
                  <Input
                    value={row.phone}
                    placeholder="010-1234-5678"
                    inputMode="tel"
                    onChange={(e) => setManualCell(index, "phone", e.target.value)}
                    onPaste={(e) => onPasteRows(e, index)}
                  />
                  <button
                    type="button"
                    aria-label={`${index + 1}행 삭제`}
                    disabled={manualRows.length === 1}
                    onClick={() => removeRow(index)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  <Plus className="mr-1.5 h-4 w-4" />행 추가
                </Button>
                <Button size="sm" onClick={onParseManual} disabled={pending}>
                  {pending && !preview ? "검증 중..." : "검증하기"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  엑셀에서 이름·휴대폰 두 칸을 복사해 붙여넣으면 여러 행이 한 번에
                  채워집니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Button asChild variant="outline" size="sm">
                <a href={`/${tenantSlug}/experts/import/template`}>
                  <Download className="mr-1.5 h-4 w-4" />
                  템플릿 다운로드
                </a>
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
                />
                <Button size="sm" onClick={onParse} disabled={pending}>
                  <FileUp className="mr-1.5 h-4 w-4" />
                  {pending && !preview ? "검증 중..." : "업로드·검증"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {preview && counts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. 검증 결과 확인 후 등록</CardTitle>
            <CardDescription>
              전체 {preview.length}행 — 등록 대상 {counts.ok ?? 0} · 오류{" "}
              {counts.error ?? 0} · 이미 연결됨 {counts.dup_linked ?? 0} ·
              요청 대기중 {counts.dup_pending ?? 0} · 파일 내 중복{" "}
              {counts.dup_file ?? 0}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(counts.dup_pending ?? 0) > 0 && (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  대기중 요청이 있는 번호 처리
                </legend>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <Label className="flex items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="dupMode"
                      checked={dupMode === "skip"}
                      onChange={() => setDupMode("skip")}
                    />
                    건너뛰기 (기존 링크 유지)
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="dupMode"
                      checked={dupMode === "reissue"}
                      onChange={() => setDupMode("reissue")}
                    />
                    다시 발급 (기존 요청 회수 후 새 링크)
                  </Label>
                </div>
              </fieldset>
            )}

            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">행</TableHead>
                    <TableHead>이름</TableHead>
                    <TableHead>휴대폰</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>비고</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow
                      key={row.rowNumber}
                      className={row.status === "error" ? "bg-destructive/5" : undefined}
                    >
                      <TableCell className="text-muted-foreground">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.name || "-"}
                      </TableCell>
                      <TableCell>
                        {row.phone ? formatKrMobile(row.phone) : row.phoneInput || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {IMPORT_STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.message || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={onCommit} disabled={pending || eligibleCount === 0}>
                {pending ? "생성 중..." : `등록 요청 ${eligibleCount}건 생성`}
              </Button>
              {eligibleCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  생성할 대상이 없습니다. 오류 행을 수정해 다시 업로드하세요.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
