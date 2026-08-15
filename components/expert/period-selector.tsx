"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PRESETS = [
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난 달" },
  { key: "quarter", label: "이번 분기" },
  { key: "year", label: "올해" },
] as const;

/**
 * 전문가 대시보드 활동 통계 기간 선택 — 프리셋 + 직접 설정(달력).
 * 선택 시 URL 파라미터로 이동해 서버에서 해당 기간으로 재계산한다.
 */
export function PeriodSelector({
  preset,
  from,
  to,
}: {
  preset: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const [showCustom, setShowCustom] = useState(preset === "custom");
  const [fromValue, setFromValue] = useState(from ?? "");
  const [toValue, setToValue] = useState(to ?? "");

  const goPreset = (key: string) => {
    setShowCustom(false);
    router.push(`/expert?period=${key}`);
  };

  const applyCustom = () => {
    if (fromValue && toValue) {
      router.push(`/expert?from=${fromValue}&to=${toValue}`);
    }
  };

  const chip = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
      active
        ? "bg-brand text-white"
        : "bg-secondary text-muted-foreground hover:text-brand-navy"
    );

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => goPreset(p.key)}
            className={chip(preset === p.key && !showCustom)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className={cn(chip(preset === "custom" || showCustom), "inline-flex items-center gap-1")}
        >
          <CalendarRange className="h-3.5 w-3.5" aria-hidden />
          직접 설정
        </button>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={fromValue}
            max={toValue || undefined}
            onChange={(e) => setFromValue(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-brand-navy"
            aria-label="시작일"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={toValue}
            min={fromValue || undefined}
            onChange={(e) => setToValue(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-brand-navy"
            aria-label="종료일"
          />
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={applyCustom}
            disabled={!fromValue || !toValue}
          >
            적용
          </Button>
        </div>
      )}
    </div>
  );
}
