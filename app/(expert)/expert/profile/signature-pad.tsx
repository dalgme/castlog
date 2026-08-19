"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignatureCanvas } from "@/components/expert/signature-canvas";
import { useToast } from "@/hooks/use-toast";

import { registerExpertSignature } from "./signature-actions";

/**
 * 단계 28-A: 서명·날인 등록.
 * 여기서 등록해 두면 수락서에 자동 배치된다. 등록하지 않았더라도 수락서
 * 승인 화면에서 그 자리에서 그릴 수 있다 — 등록이 승인을 막지는 않는다.
 */
export function SignaturePad({
  kind,
  label,
  registered,
}: {
  kind: "signature" | "seal";
  label: string;
  registered: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // 저장 뒤 캔버스를 비우기 위한 키 — 그림이 남아 있으면 저장됐는지 알 수 없다
  const [resetKey, setResetKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function save() {
    if (!dataUrl) {
      toast({
        variant: "destructive",
        description: `${label}을(를) 그린 뒤 저장하세요.`,
      });
      return;
    }
    startTransition(async () => {
      const result = await registerExpertSignature(kind, dataUrl);
      if (result.ok) {
        toast({ description: `${label}을(를) 등록했습니다.` });
        setDataUrl(null);
        setResetKey((k) => k + 1);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {registered ? (
          <Badge>등록됨</Badge>
        ) : (
          <Badge variant="secondary">미등록</Badge>
        )}
      </div>
      <SignatureCanvas key={resetKey} onChange={setDataUrl} disabled={pending} />
      <Button type="button" size="sm" onClick={save} disabled={pending}>
        {pending ? "저장 중..." : registered ? "새로 등록(교체)" : "등록"}
      </Button>
    </div>
  );
}
