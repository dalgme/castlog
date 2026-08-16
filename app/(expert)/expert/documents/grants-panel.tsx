"use client";

import { useTransition } from "react";

import {
  DOCUMENT_TYPE_LABELS,
  STANDARD_UPLOAD_DOCUMENT_TYPES,
} from "@/lib/experts/documents";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

import { setDocumentGrant } from "./actions";

/**
 * 기업별 서류 열람 허용 패널 — 허용의 주체는 서류 소유자인 전문가 본인.
 * 체크 = 해당 기업이 그 유형의 서류를 열람 가능 (열람 시 전 건 로그).
 */
export function DocumentGrantsPanel({
  linkId,
  grantedTypes,
}: {
  linkId: string;
  grantedTypes: string[];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onToggle(documentType: string, next: boolean) {
    startTransition(async () => {
      const result = await setDocumentGrant(linkId, documentType, next);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {STANDARD_UPLOAD_DOCUMENT_TYPES.map((type) => {
        const granted = grantedTypes.includes(type);
        return (
          <label
            key={type}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <Checkbox
              checked={granted}
              disabled={pending}
              onCheckedChange={(checked) => onToggle(type, checked === true)}
            />
            <span>{DOCUMENT_TYPE_LABELS[type]}</span>
          </label>
        );
      })}
    </div>
  );
}
