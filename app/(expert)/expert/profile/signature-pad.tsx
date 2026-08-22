"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SignatureCanvas } from "@/components/expert/signature-canvas";
import { useToast } from "@/hooks/use-toast";

import {
  registerExpertSignature,
  registerExpertSignatureUpload,
} from "./signature-actions";

/**
 * 단계 28-A + 개정 2026-08-22: 서명·날인 등록.
 * - 서명: 직접 그리기 + 이미지 파일 업로드 겸용
 * - 날인(도장): 직접 찍을 수 없으니 파일 업로드 전용
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);
  const { toast } = useToast();

  const canDraw = kind === "signature";
  // 등록된 뒤에는 '수정하기'로 — 등록 완료 상태가 한눈에 보이게 (기획 확정 2026-08-22)
  const isRegistered = registered || justRegistered;
  const savedButtonClass = "bg-emerald-600 text-white hover:bg-emerald-700";

  function saveDrawing() {
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
        setJustRegistered(true);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function saveUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast({ variant: "destructive", description: "이미지 파일을 선택하세요." });
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("fileName", file.name); // 한글 파일명 보전
    startTransition(async () => {
      const result = await registerExpertSignatureUpload(kind, formData);
      if (result.ok) {
        toast({ description: `${label} 이미지를 등록했습니다.` });
        if (fileRef.current) fileRef.current.value = "";
        setFileName(null);
        setJustRegistered(true);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {isRegistered ? (
          <Badge>등록됨</Badge>
        ) : (
          <Badge variant="secondary">미등록</Badge>
        )}
      </div>

      {canDraw && (
        <>
          <SignatureCanvas
            key={resetKey}
            onChange={setDataUrl}
            disabled={pending}
          />
          <Button
            type="button"
            size="sm"
            onClick={saveDrawing}
            disabled={pending}
            className={isRegistered ? savedButtonClass : undefined}
          >
            {pending ? "저장 중..." : isRegistered ? "수정하기" : "등록"}
          </Button>
        </>
      )}

      {/* 이미지 파일 업로드 — 서명은 겸용, 날인은 이 경로만 */}
      <div className="rounded-md border border-dashed p-3">
        <p className="mb-2 text-xs text-muted-foreground">
          {canDraw
            ? "또는 준비된 서명 이미지 파일(PNG/JPG, 2MB 이하)을 업로드할 수 있습니다."
            : "도장을 찍어 스캔·촬영한 이미지 파일(PNG/JPG, 2MB 이하)을 업로드하세요."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            disabled={pending}
            className="text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-coral file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-coral-dark"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <Button
            type="button"
            size="sm"
            variant={canDraw ? "outline" : "default"}
            className={
              isRegistered && !canDraw
                ? `shrink-0 ${savedButtonClass}`
                : "shrink-0"
            }
            disabled={pending || !fileName}
            onClick={saveUpload}
          >
            <Upload className="mr-1 h-3.5 w-3.5" aria-hidden />
            {pending
              ? "등록 중..."
              : isRegistered
                ? canDraw
                  ? "파일로 수정하기"
                  : "수정하기"
                : "파일로 등록"}
          </Button>
        </div>
      </div>
    </div>
  );
}
