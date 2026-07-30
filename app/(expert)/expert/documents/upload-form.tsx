"use client";

import { useRef, useState, useTransition } from "react";

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
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="text-xs file:mr-2 file:text-xs"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <Button
        type="submit"
        size="sm"
        variant={hasExisting ? "outline" : "default"}
        disabled={pending || !fileName}
        className="shrink-0"
      >
        {pending ? "업로드 중..." : hasExisting ? "교체" : "업로드"}
      </Button>
    </form>
  );
}
