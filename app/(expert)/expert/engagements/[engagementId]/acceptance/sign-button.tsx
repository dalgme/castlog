"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SignatureCanvas } from "@/components/expert/signature-canvas";

import { signAcceptance } from "./sign-actions";

/**
 * 수락서 정보 확인 완료 및 승인(서명).
 *
 * 승인하면 그 자리에서 확정된다 — 기업의 추가 확인을 기다리지 않는다.
 * 서명을 미리 등록해 두지 않은 전문가도 여기서 바로 그릴 수 있다. 등록이
 * 안 됐다는 이유로 승인이 막히면, 전문가는 프로필로 갔다가 다시 돌아와야 한다.
 */
export function AcceptanceSignButton({
  acceptanceId,
  status,
  signedAt,
  hasSignature,
}: {
  acceptanceId: string;
  status: string;
  signedAt: string | null;
  /** 등록된 서명이 문서에 이미 박혀 있는가 */
  hasSignature: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (status === "confirmed" || status === "signed") {
    return (
      <Alert>
        <AlertDescription className="flex flex-wrap items-start gap-2 text-sm">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 flex-none text-green-600"
            aria-hidden
          />
          <span className="font-semibold">
            확인·승인이 완료되었습니다. 참여가 확정되었습니다.
          </span>
          {signedAt && (
            <span className="text-muted-foreground">
              ({new Date(signedAt).toLocaleString("ko-KR")})
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await signAcceptance(
        acceptanceId,
        dataUrl ? { dataUrl, kind: "signature" } : undefined
      );
      if (!r.ok) {
        setError(r.error);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  const ready = hasSignature || dataUrl !== null;

  return (
    <div className="space-y-3 rounded-lg border-2 border-brand bg-white p-4">
      <div>
        <p className="text-sm font-bold text-brand-navy">
          아래 내용을 확인하신 뒤 승인해 주세요
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          승인하시면 서명이 수락서에 기록되고 참여가 <strong>확정</strong>됩니다.
          확정 후 부득이하게 참여가 어려워지면 섭외 목록에서 긴급 취소를 요청할 수
          있습니다.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {hasSignature ? (
        <p className="rounded-md bg-secondary/40 p-2.5 text-xs text-muted-foreground">
          등록해 두신 서명·날인이 수락서에 배치되어 있습니다. 다시 그리실 필요는
          없습니다.
        </p>
      ) : (
        <div>
          <p className="text-xs font-semibold">서명 (필수)</p>
          <p className="mb-1.5 text-xs text-muted-foreground">
            아래 칸에 손가락·펜·마우스로 서명해 주세요. 여기서 그린 서명은 내
            서명으로 등록되어 다음 수락서에도 자동으로 쓰입니다.
          </p>
          <SignatureCanvas onChange={setDataUrl} disabled={pending} />
        </div>
      )}

      {confirming ? (
        <div className="space-y-2 rounded-md border border-brand bg-brand/[0.06] p-3">
          <p className="text-sm font-semibold text-brand-navy">
            수락서 내용을 모두 확인하셨습니까? 승인하면 참여가 확정됩니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} disabled={pending}>
              {pending ? "처리 중…" : "예, 확인했고 승인합니다"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              아니오
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="w-full sm:w-auto"
          onClick={() => setConfirming(true)}
          disabled={pending || !ready}
        >
          <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
          수락서 정보 확인 완료 및 승인(서명)
        </Button>
      )}
      {!ready && (
        <p className="text-xs text-muted-foreground">
          서명을 그리시면 승인 버튼이 열립니다.
        </p>
      )}
    </div>
  );
}
