"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";

import { DOCUMENT_ACCEPT_ATTR } from "@/lib/experts/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import { uploadBulkExpertDocument } from "../../import/document-actions";

/**
 * 이력서 대리 등록 (렛츠 요청 2026-11-11 — 전문가가 포털에 올리지 않아 회사가 보유 파일을 직접 넣는다).
 *
 * 일괄 등록(파일 일괄 등록)과 같은 서버 액션을 한 명·이력서 한 건으로 쓴다 — 규칙도 같다:
 * 전문가 본인이 올린 이력서가 있으면 덮지 않고, 자사가 올린 것만 교체한다. 올린 파일은 자사가 자동
 * 열람하고(출처 기준) AI 이력 요약이 바로 만들어진다. 전문가는 포털에서 이 파일을 보고 바꿀 수 있다.
 */
export function TenantResumeUpload({
  expertId,
  expertName,
  hasResume,
  resumeByUs,
}: {
  expertId: string;
  expertName: string;
  /** 활성 이력서가 이미 있는가 */
  hasResume: boolean;
  /** 그 이력서를 자사가 올렸는가 (교체 가능) — 전문가 본인 등록분이면 버튼을 잠근다 */
  resumeByUs: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const lockedByExpert = hasResume && !resumeByUs;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const picked = inputRef.current?.files?.[0];
    if (!picked) return;
    const formData = new FormData();
    formData.set("expertId", expertId);
    formData.set("docType", "resume");
    formData.set("file", picked);
    // 한글 파일명 보전 — 문자열 필드로 함께 보낸다 (전문가 포털 업로드와 같은 방식)
    formData.set("fileName", picked.name);
    startTransition(async () => {
      const result = await uploadBulkExpertDocument(formData);
      if (result.ok) {
        toast({
          description: result.replaced
            ? `${expertName} 전문가의 이력서를 새 파일로 교체했습니다. AI 이력 요약도 다시 만들어집니다.`
            : `${expertName} 전문가의 이력서를 등록했습니다. 잠시 뒤 AI 이력 요약이 만들어집니다.`,
        });
        setFileName(null);
        form.reset();
        router.refresh();
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start gap-2">
        <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-navy">이력서 대리 등록</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            전문가가 포털에 이력서를 올리지 않았을 때, 회사가 보유한 이력서 파일(PDF·HWP·DOCX·이미지)을 대신 등록합니다.
            등록한 파일은 우리 회사가 바로 볼 수 있고 AI 이력 요약이 만들어집니다. 전문가 본인도 포털에서 이 파일을 보고
            바꿀 수 있으며, 전문가가 직접 올린 이력서가 있으면 회사가 덮어쓸 수 없습니다.
          </p>
          {lockedByExpert ? (
            <p className="mt-2 text-xs text-muted-foreground">
              이 전문가는 본인이 이력서를 직접 등록했습니다 — 회사가 바꿀 수 없습니다(규칙). 수정이 필요하면 전문가에게 포털에서 교체를 요청하세요.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                ref={inputRef}
                type="file"
                name="file"
                accept={DOCUMENT_ACCEPT_ATTR}
                className="text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                disabled={pending}
              />
              <Button type="submit" size="sm" variant={hasResume ? "outline" : "default"} disabled={pending || !fileName}>
                {pending ? "등록 중…" : hasResume ? "이력서 교체" : "이력서 등록"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
