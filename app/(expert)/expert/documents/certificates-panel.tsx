"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Plus, Trash2, Upload } from "lucide-react";

import { DOCUMENT_ACCEPT_ATTR } from "@/lib/experts/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import {
  deleteCertificate,
  saveCertificateInfo,
  uploadCertificateFile,
} from "./certificate-actions";

export type CertificateRow = {
  id: string;
  documentId: string;
  fileName: string;
  createdAt: string;
  certName: string;
  issuedOn: string;
  issuer: string;
  note: string;
};

/**
 * 자격증 사본 관리 (기획 확정 2026-08-22) — 여러 건 업로드, 건별로
 * 자격증명·급수 / 발급일 / 발급기관 / 기타를 직접 작성.
 * 미리보기 / 삭제 / 수정 등록(파일 교체) 버튼을 건별 제공.
 */
export function CertificatesPanel({ rows }: { rows: CertificateRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const addFileRef = useRef<HTMLInputElement>(null);
  const [addFileName, setAddFileName] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, doneMsg: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error ?? "실패했습니다." });
      } else {
        toast({ description: doneMsg });
        router.refresh();
      }
    });
  }

  function addCertificate() {
    const file = addFileRef.current?.files?.[0];
    if (!file) {
      toast({ variant: "destructive", description: "파일을 선택하세요." });
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("fileName", file.name); // 한글 파일명 보전
    run(async () => {
      const r = await uploadCertificateFile(formData);
      if (r.ok) {
        if (addFileRef.current) addFileRef.current.value = "";
        setAddFileName(null);
      }
      return r;
    }, "자격증 사본이 등록되었습니다. 아래에서 자격증 정보를 작성해 주세요.");
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <CertificateItem key={row.id} row={row} pending={pending} run={run} />
      ))}

      <div className="rounded-md border border-dashed p-3">
        <p className="mb-2 text-sm font-semibold">자격증 추가</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            ref={addFileRef}
            type="file"
            accept={DOCUMENT_ACCEPT_ATTR}
            className="text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-coral file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-coral-dark"
            onChange={(e) => setAddFileName(e.target.files?.[0]?.name ?? null)}
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={pending || !addFileName}
            onClick={addCertificate}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            업로드 추가
          </Button>
        </div>
      </div>
    </div>
  );
}

function CertificateItem({
  row,
  pending,
  run,
}: {
  row: CertificateRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, doneMsg: string) => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const [certName, setCertName] = useState(row.certName);
  const [issuedOn, setIssuedOn] = useState(row.issuedOn);
  const [issuer, setIssuer] = useState(row.issuer);
  const [note, setNote] = useState(row.note);

  function replaceFile() {
    const file = replaceRef.current?.files?.[0];
    if (!file) {
      // 파일 선택창을 연다 — '수정 등록' 한 번으로 교체가 시작되게
      replaceRef.current?.click();
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("fileName", file.name); // 한글 파일명 보전
    formData.set("certificateId", row.id);
    run(async () => {
      const r = await uploadCertificateFile(formData);
      if (r.ok && replaceRef.current) replaceRef.current.value = "";
      return r;
    }, "자격증 사본이 새 파일로 교체되었습니다.");
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{row.fileName}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString("ko-KR")} 등록
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <Link href={`/expert/documents/${row.documentId}/preview`}>
              <Eye className="mr-1 h-3.5 w-3.5" aria-hidden />
              미리보기
            </Link>
          </Button>
          <input
            ref={replaceRef}
            type="file"
            accept={DOCUMENT_ACCEPT_ATTR}
            className="hidden"
            onChange={replaceFile}
          />
          <Button size="sm" variant="outline" disabled={pending} onClick={replaceFile}>
            <Upload className="mr-1 h-3.5 w-3.5" aria-hidden />
            수정 등록
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm("이 자격증 사본을 삭제할까요?")) {
                run(() => deleteCertificate(row.id), "자격증이 삭제되었습니다.");
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          value={certName}
          onChange={(e) => setCertName(e.target.value)}
          placeholder="자격증명 및 급수 (예: 경영지도사 2급)"
          className="h-9 text-sm"
        />
        <Input
          value={issuedOn}
          onChange={(e) => setIssuedOn(e.target.value)}
          placeholder="발급일 (예: 2023-05-10)"
          className="h-9 text-sm"
        />
        <Input
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="발급기관 (예: 한국산업인력공단)"
          className="h-9 text-sm"
        />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="기타 (선택)"
          className="h-9 text-sm"
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          run(
            () => saveCertificateInfo(row.id, { certName, issuedOn, issuer, note }),
            "자격증 정보가 저장되었습니다."
          )
        }
      >
        정보 저장
      </Button>
    </div>
  );
}
