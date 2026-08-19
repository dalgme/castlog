"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";

import { saveTenantLogo, removeTenantLogo } from "./logo-actions";

const MAX_PX = 400;

/**
 * 회사 로고 등록.
 *
 * 브라우저에서 캔버스로 400px PNG까지 줄여서 보낸다. 원본을 그대로 올리면
 * 몇 MB짜리 인쇄용 로고가 들어와 화면마다 그 무게를 지고 다니게 된다
 * (CLAUDE.md §6 — 이미지는 리사이즈를 거친다).
 */
export function TenantLogoForm({
  currentSrc,
  canEdit,
}: {
  /** 지금 등록된 로고 주소 (없으면 null) */
  currentSrc: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);

    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("PNG · JPG · WEBP 이미지만 올릴 수 있습니다.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("파일이 너무 큽니다 (8MB 이하).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        // 긴 변 기준 400px — 비율은 유지한다
        const scale = Math.min(1, MAX_PX / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setError("이미지를 처리할 수 없습니다.");
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        setPreview(canvas.toDataURL("image/png"));
      };
      image.onerror = () => setError("이미지를 열 수 없습니다.");
      image.src = String(reader.result);
    };
    reader.onerror = () => setError("파일을 읽을 수 없습니다.");
    reader.readAsDataURL(file);
  }

  function save() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await saveTenantLogo(preview);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeTenantLogo();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const shown = preview ?? currentSrc;

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-white">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="회사 로고"
              className="max-h-14 max-w-14 object-contain"
            />
          ) : (
            <LogoMark width={22} height={27} />
          )}
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {preview
              ? "미리보기 — 저장해야 반영됩니다"
              : currentSrc
                ? "등록됨"
                : "미등록 — 캐스트로그 기본 심볼이 쓰입니다"}
          </p>
          <p className="mt-0.5">
            사이드바·챗봇 등 기업 사용자 화면에 함께 쓰입니다. 긴 변 400px PNG로
            자동 변환되며, 로그인한 자사 사용자에게만 보입니다.
          </p>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={pick}
            disabled={pending}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Button size="sm" onClick={save} disabled={pending || !preview}>
            <ImageUp className="mr-1.5 h-3.5 w-3.5" />
            {pending ? "저장 중…" : "로고 저장"}
          </Button>
          {currentSrc && !preview && (
            <Button
              size="sm"
              variant="outline"
              onClick={remove}
              disabled={pending}
              className="border-destructive/40 text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              제거
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          회사 로고는 대표 또는 ‘테넌트 설정’ 위임자가 등록합니다.
        </p>
      )}
    </div>
  );
}
