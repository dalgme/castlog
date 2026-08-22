"use client";

import { useRef, useState, useTransition } from "react";

import { DOCUMENT_ACCEPT_ATTR } from "@/lib/experts/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import { uploadExpertDocument } from "./actions";

/** 서류 유형별 업로드 컨트롤 — 파일 선택 즉시 검증은 서버에서 (용량·확장자) */
export function DocumentUploadForm({
  documentType,
  hasExisting,
}: {
  documentType: string;
  hasExisting: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    // 한글 파일명이 multipart 경계에서 깨지는 경우가 있다 — 브라우저의
    // 문자열 값은 안전하므로 파일명을 별도 필드로 함께 보낸다
    const picked = inputRef.current?.files?.[0];
    if (picked) formData.set("fileName", picked.name);
    startTransition(async () => {
      const result = await uploadExpertDocument(formData);
      if (result.ok) {
        toast({ description: "서류가 업로드되었습니다." });
        setFileName(null);
        form.reset();
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="documentType" value={documentType} />
      <Input
        ref={inputRef}
        type="file"
        name="file"
        accept={DOCUMENT_ACCEPT_ATTR}
        className="text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-coral file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-coral-dark"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <Button
        type="submit"
        size="sm"
        variant={hasExisting ? "outline" : "default"}
        disabled={pending || !fileName}
        className="shrink-0"
      >
        {pending ? "업로드 중..." : hasExisting ? "수정 등록" : "업로드"}
      </Button>
    </form>
  );
}
