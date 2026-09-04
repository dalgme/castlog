"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, FileUp } from "lucide-react";

import {
  DIRECT_IMPORT_STATUS_LABELS,
  type DirectImportPreviewRow,
} from "@/lib/experts/direct-import";
import { formatKrMobile } from "@/lib/auth/phone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  commitDirectImport,
  parseDirectImport,
  type CommitDirectImportResult,
} from "./direct-actions";

const STATUS_VARIANT: Record<
  DirectImportPreviewRow["status"],
  "default" | "secondary" | "destructive"
> = {
  create: "default",
  link: "secondary",
  already: "secondary",
  dup_file: "secondary",
  error: "destructive",
};

/**
 * 2. 보유자료로 전문가 가입/등록 — 엑셀(10항목) 업로드 즉시 가입·정보 기입.
 * 등록 요청 링크(1번)와 달리 전문가 확인 없이 레코드가 만들어지므로,
 * 미리보기에서 무엇이 생성/연결/건너뜀인지 명확히 보여 준 뒤 확정한다.
 */
export function DirectImportClient({ tenantSlug }: { tenantSlug: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DirectImportPreviewRow[] | null>(null);
  const [result, setResult] = useState<
    Extract<CommitDirectImportResult, { ok: true }> | null
  >(null);

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
      const parsed = await parseDirectImport(formData);
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
    // 이름·이메일이 기존 전문가와 겹치는 신규 행 — 확정 전 재확인 (기획 24번)
    const similarRows = preview.filter(
      (r) => r.status === "create" && r.similarMatch
    );
    if (similarRows.length > 0) {
      const ok = window.confirm(
        `이미 등록된 전문가와 이름 또는 이메일이 겹치는 행이 ${similarRows.length}건 있습니다:\n` +
          similarRows
            .map((r) => `· ${r.input.name} (${r.input.phone})`)
            .join("\n") +
          `\n\n번호가 바뀐 동일인이라면 신규 등록 대신 기존 전문가의 번호를 먼저 확인하세요.` +
          `\n다른 사람이 맞다면 그대로 진행합니다. 등록할까요?`
      );
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const res = await commitDirectImport(
        preview.map((r) => ({ ...r.input }))
      );
      if (res.ok) {
        setResult(res);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setError(res.error);
      }
    });
  }

  const actionableCount =
    preview?.filter((r) => r.status === "create" || r.status === "link")
      .length ?? 0;

  return (
    /* 1번(등록 요청)과 성격이 다른 강한 행위(즉시 생성)라 색으로 구획을 가른다
       (기획 확정 2026-08-23 — 가독성 향상) */
    <Card className="overflow-hidden border-teal-300 bg-teal-50/50">
      <div className="bg-teal-600 px-6 py-2.5 text-sm font-bold text-white">
        2. 보유자료로 전문가 가입/등록 — 명단으로 즉시 생성
      </div>
      <CardHeader className="pb-2 pt-4">
        <CardDescription className="text-teal-950/80">
          회사가 보유한 명단(이름·이메일·핸드폰·계좌·거주지·학위/자격증·강의분야·이력)을
          올리면 <b>즉시 전문가로 가입·등록</b>되고 우리 회사와의 관계(관계기업)가
          만들어집니다. 전문가 본인은 이 번호로 휴대폰 인증 로그인하는 순간 자기
          계정으로 이어받습니다. 명단의 개인정보는 회사가 적법하게 보유한
          자료여야 하며, 등록 사실 고지는 회사의 책임입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/${tenantSlug}/experts/import/direct-template`}
              prefetch={false}
            >
              <Download className="mr-1 h-4 w-4" />
              템플릿 다운로드 (10개 항목)
            </Link>
          </Button>
          <Input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="max-w-xs"
          />
          <Button size="sm" onClick={onParse} disabled={pending}>
            <FileUp className="mr-1 h-4 w-4" />
            업로드·검증
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert>
            <AlertDescription>
              완료 — 신규 가입 {result.created}명 · 기존 전문가 관계 추가{" "}
              {result.linked}명 · 건너뜀 {result.skipped}건.{" "}
              <Link
                href={`/${tenantSlug}/experts/manage`}
                className="underline underline-offset-2"
              >
                전문가 관리에서 검토하기
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>판정</TableHead>
                    <TableHead>이름</TableHead>
                    <TableHead>핸드폰</TableHead>
                    <TableHead>강의분야</TableHead>
                    <TableHead>비고</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.index}>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANT[row.status]}
                          className="text-[10px]"
                        >
                          {DIRECT_IMPORT_STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.input.name || "—"}</TableCell>
                      <TableCell>
                        {row.phoneE164
                          ? formatKrMobile(row.phoneE164)
                          : row.input.phone || "—"}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs">
                        {row.expertiseFields.join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.message ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button onClick={onCommit} disabled={pending || actionableCount === 0}>
              {pending
                ? "등록 중..."
                : `${actionableCount}명 가입/등록 확정`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
