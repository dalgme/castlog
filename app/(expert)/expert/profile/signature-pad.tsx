"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import { registerExpertSignature } from "./signature-actions";

/**
 * 단계 28-A: 서명·날인 캔버스 (의존성 없는 순수 canvas).
 * 포인터로 그린 뒤 저장하면 PNG로 암호화 버킷에 등록된다.
 * 모바일 완전 대응(전문가 최우선 — CLAUDE.md 10): 터치/펜/마우스 공용 pointer 이벤트.
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // 캔버스 해상도 초기화 (레이아웃 폭 기준 · devicePixelRatio 반영)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!dirty) setDirty(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    last.current = null;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas || !dirty) {
      toast({ variant: "destructive", description: `${label}을(를) 그린 뒤 저장하세요.` });
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    startTransition(async () => {
      const result = await registerExpertSignature(kind, dataUrl);
      if (result.ok) {
        toast({ description: `${label}을(를) 등록했습니다.` });
        clear();
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
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-md border border-dashed bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={clear}
          disabled={pending}
        >
          지우기
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "저장 중..." : registered ? "새로 등록(교체)" : "등록"}
        </Button>
      </div>
    </div>
  );
}
