"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { signAcceptance } from "./sign-actions";

/**
 * 전문가 확인 및 전자서명 (Phase A-3).
 * 등록해 둔 서명·날인이 문서에 자동 배치되며, 이 버튼은 최종 확인을 기록한다.
 */
export function AcceptanceSignButton({
  acceptanceId,
  status,
  signedAt,
}: {
  acceptanceId: string;
  status: string;
  signedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "signed" || status === "confirmed") {
    return (
      <Alert>
        <AlertDescription className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-green-600" aria-hidden />
          {status === "confirmed"
            ? "서명 완료 · 기업 담당자가 확인했습니다."
            : "확인·전자서명이 완료되었습니다. 기업 담당자 확인을 기다리고 있습니다."}
          {signedAt && (
            <span className="text-muted-foreground">
              ({new Date(signedAt).toLocaleString("ko-KR")})
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const onSign = () => {
    if (
      !window.confirm(
        "수락서 내용을 확인하셨습니까? 확인 시 등록된 서명·날인으로 전자서명됩니다."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await signAcceptance(acceptanceId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSign} disabled={pending}>
          <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
          {pending ? "처리 중..." : "확인 및 전자서명"}
        </Button>
        <span className="text-xs text-muted-foreground">
          등록된 서명·날인이 문서에 자동 배치됩니다.
        </span>
      </div>
    </div>
  );
}
