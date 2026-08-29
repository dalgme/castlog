"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * 서명·날인 캔버스 (의존성 없는 순수 canvas).
 *
 * 프로필의 서명 등록과 수락서 승인 서명이 같은 그리기 도구를 쓴다 — 전문가가
 * 두 곳에서 다른 조작을 익혀야 할 이유가 없다. 그린 결과는 PNG data URL로
 * 부모에게 올라가고, 저장 방식(등록이냐 승인이냐)은 부모가 정한다.
 *
 * 모바일 완전 대응(전문가 최우선 — CLAUDE.md §10): 터치·펜·마우스 공용 pointer 이벤트.
 */
export function SignatureCanvas({
  onChange,
  disabled,
  heightClass = "h-40",
}: {
  /** 그리면 PNG data URL, 지우면 null */
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  heightClass?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  // 실제로 획을 그렸는지 — 리사이즈 복원 판정용. state가 아니라 ref인 이유:
  // ResizeObserver 콜백은 리렌더와 무관하게 최신 값을 봐야 한다 (리뷰 1:
  // 빈 캔버스 스냅샷이 onChange로 올라가면 빈 서명으로 승인·등록된다)
  const dirtyRef = useRef(false);
  // 최신 onChange를 ref로 유지 (리사이즈 복원 시 사용)
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 캔버스 해상도 설정 (레이아웃 폭 기준 · devicePixelRatio 반영).
  // 마운트 1회 고정이 아니라 **리사이즈·화면 회전을 따라간다** — 고정하면
  // 회전 순간 터치 좌표가 어긋나고 그리던 서명이 사라진다 (검수 3a).
  // 재설정 전에 그린 내용을 떠 두었다가 새 해상도에 다시 그려 획을 보존한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setup = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const nextW = Math.round(width * ratio);
      const nextH = Math.round(height * ratio);
      if (canvas.width === nextW && canvas.height === nextH) return;

      // 기존 획 보존 — 크기 변경은 캔버스 내용을 지운다.
      // **사용자가 실제로 그린 경우에만** 스냅샷·복원·통지한다 — 빈 캔버스를
      // 떠서 올리면 빈 PNG가 서명으로 등록·승인된다 (리뷰 1)
      const hadContent =
        dirtyRef.current && canvas.width > 0 && canvas.height > 0;
      const snapshot = hadContent ? canvas.toDataURL("image/png") : null;
      const prevW = canvas.width;
      const prevH = canvas.height;

      canvas.width = nextW;
      canvas.height = nextH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";

      if (snapshot && prevW > 0 && prevH > 0) {
        const img = new Image();
        img.onload = () => {
          // 이전 그림을 새 논리 크기에 맞춰 다시 그린다 (비율 유지 축소/확대)
          ctx.drawImage(img, 0, 0, width, height);
          onChangeRef.current(canvas.toDataURL("image/png"));
        };
        img.src = snapshot;
      }
    };

    setup();
    const observer = new ResizeObserver(() => setup());
    observer.observe(canvas);
    return () => observer.disconnect();
    // onChange는 ref로 참조 — 부모 리렌더마다 캔버스를 다시 만들지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
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
    dirtyRef.current = true;
    if (!dirty) setDirty(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirtyRef.current = false;
    setDirty(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className={`${heightClass} w-full touch-none rounded-md border border-dashed bg-white`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={clear}
        disabled={disabled || !dirty}
      >
        지우기
      </Button>
    </div>
  );
}
