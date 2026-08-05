"use client";

import { useState, useTransition } from "react";
import { FileUp, Copy, Check } from "lucide-react";

import {
  DOCUMENT_TYPE_LABELS,
  UPLOADABLE_DOCUMENT_TYPES,
} from "@/lib/experts/documents";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { createDocumentRequest } from "@/app/(dashboard)/[tenantSlug]/experts/document-request-actions";

/** 서류 제출·갱신 요청 다이얼로그 — /d 공개 링크 생성·복사 */
export function DocumentRequestDialog({ expertId }: { expertId: string }) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggle(type: string, checked: boolean) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  function onCreate() {
    if (types.size === 0) {
      setServerError("요청할 서류 유형을 선택하세요.");
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await createDocumentRequest(
        expertId,
        Array.from(types),
        message
      );
      if (result.ok) setCreatedUrl(result.url);
      else setServerError(result.error);
    });
  }

  async function copyUrl() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTypes(new Set());
      setMessage("");
      setServerError(null);
      setCreatedUrl(null);
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileUp className="mr-1.5 h-4 w-4" />
          서류 요청
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>서류 제출·갱신 요청</DialogTitle>
          <DialogDescription>
            전문가에게 전달할 제출 링크(/d)를 생성합니다. 전문가는 링크 확인 후
            포털 서류함에서 업로드합니다 (업무연락 — 사전동의 불요).
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                제출 요청 링크가 생성되었습니다 (유효기간 14일). 전문가에게
                전달하세요.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input readOnly value={createdUrl} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={copyUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {UPLOADABLE_DOCUMENT_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={types.has(type)}
                    onCheckedChange={(checked) => toggle(type, checked === true)}
                  />
                  {DOCUMENT_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="요청 사유·기한 등 안내 (선택)"
              maxLength={500}
            />
            <Button
              type="button"
              className="w-full"
              disabled={pending}
              onClick={onCreate}
            >
              {pending ? "생성 중..." : "제출 링크 생성"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
