"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKoreanDate } from "@/lib/checklists/dates";

/**
 * 권장 마감일 단추 (기획 지시 2026-09-20, 개정 09-21) — 권장(D±)과 자동 마감일을 한 칸으로.
 * 평소에는 글자 없는 작은 단추만 보이고, **누르고 있는 동안만** 레이어로
 * "D-40 · 권장 마감일 09월 06일(일)"이 뜬다. 권장값은 프로젝트에서 조정하지 않는다.
 */
export function RecommendButton({
  offsetDays,
  autoDue,
  hasDday,
}: {
  offsetDays: number | null;
  autoDue: string | null;
  hasDday: boolean;
}) {
  const [held, setHeld] = useState(false);
  if (offsetDays === null) return <span className="text-muted-foreground">-</span>;
  const label = `D${offsetDays >= 0 ? "+" : "-"}${Math.abs(offsetDays)}`;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`권장 ${label} — 누르고 있으면 권장 마감일 표시`}
        title="누르고 있으면 권장 정보가 보입니다"
        onPointerDown={(e) => {
          e.preventDefault();
          setHeld(true);
        }}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setHeld(true);
          }
        }}
        onKeyUp={() => setHeld(false)}
        onBlur={() => setHeld(false)}
        className={cn(
          "inline-flex h-6 w-6 select-none items-center justify-center rounded border transition-colors",
          held ? "border-brand bg-brand text-white" : "border-input bg-white text-muted-foreground hover:border-brand hover:text-brand"
        )}
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      </button>
      {held && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border bg-white px-2 py-1.5 text-xs shadow-md"
        >
          <span className="font-mono text-[11px] font-semibold text-brand">{label}</span>
          <span className="ml-1 text-[10px] text-muted-foreground">(D-Day 기준)</span>
          <br />
          <span className="text-[10px] text-muted-foreground">권장 마감일</span>{" "}
          <span className="font-semibold">
            {autoDue ? formatKoreanDate(autoDue) : hasDday ? "-" : "D-Day 미정 — 기본설정에서 지정"}
          </span>
        </span>
      )}
    </span>
  );
}
