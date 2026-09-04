"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";

import { useToast } from "@/hooks/use-toast";

import { adjustSlotCount } from "./slot-actions";

/**
 * 세션별 필요인원 인라인 수정 (기획 지시 2026-08-30 — 28번).
 * 섭외후보 등록의 세션 정보 줄에서 바로 −/+로 고친다. "필요 OO명"은 코랄색.
 * 늘리면 후보 TO가 3배수까지 자동 발급된다 (adjustSlotCount 기존 규칙).
 */
export function RequiredCountEditor({
  slotId,
  value,
  candidateCount,
  editable,
}: {
  slotId: string;
  value: number;
  candidateCount: number;
  /** 배정 단계 + 입력 권한일 때만 수정 가능 */
  editable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // 낙관적 표시 — 서버 확정 전 깜빡임을 줄인다 (실패 시 원복)
  const [shown, setShown] = useState(value);

  function change(delta: number) {
    const next = shown + delta;
    if (next < 1 || next > 100 || pending) return;
    const prev = shown;
    setShown(next);
    startTransition(async () => {
      const res = await adjustSlotCount(slotId, next);
      if (!res.ok) {
        setShown(prev);
        toast({ variant: "destructive", description: res.error });
      } else {
        router.refresh();
      }
    });
  }

  const label = (
    // 코랄색 표기 (기획 지시 — 28번)
    <span className="text-xs font-semibold text-brand-coral">
      필요 {shown}명
    </span>
  );

  if (!editable) {
    return (
      <span className="text-xs text-muted-foreground">
        {label} · 후보 {candidateCount}명
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <button
        type="button"
        aria-label="필요인원 줄이기"
        disabled={pending || shown <= 1}
        onClick={() => change(-1)}
        className="inline-flex h-5 w-5 items-center justify-center rounded border text-brand-coral transition-colors hover:bg-brand-coral/10 disabled:opacity-40"
      >
        <Minus className="h-3 w-3" aria-hidden />
      </button>
      {label}
      <button
        type="button"
        aria-label="필요인원 늘리기"
        disabled={pending || shown >= 100}
        onClick={() => change(1)}
        className="inline-flex h-5 w-5 items-center justify-center rounded border text-brand-coral transition-colors hover:bg-brand-coral/10 disabled:opacity-40"
      >
        <Plus className="h-3 w-3" aria-hidden />
      </button>
      <span>· 후보 {candidateCount}명</span>
    </span>
  );
}
