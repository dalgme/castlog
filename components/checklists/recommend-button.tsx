"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatKoreanDate } from "@/lib/checklists/dates";

/**
 * 권장 마감일 단추 (기획 지시 2026-09-20) — 권장(D±)과 자동 마감일을 한 칸으로.
 * 평소에는 "D-5"만 보이고, **누르고 있는 동안만** 레이어로 자동 마감일이 뜬다.
 * 권장값은 프로젝트에서 조정하지 않는다 — 표준시트의 값이다.
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
        aria-label={`권장 ${label} — 누르고 있으면 자동 마감일 표시`}
        title="누르고 있으면 권장 마감일이 보입니다"
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
          "select-none rounded border px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors",
          held ? "border-brand bg-brand text-white" : "border-input bg-white text-foreground hover:border-brand"
        )}
      >
        {label}
      </button>
      {held && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border bg-white px-2 py-1.5 text-xs shadow-md"
        >
          <span className="text-[10px] text-muted-foreground">권장 마감일 (D-Day {label})</span>
          <br />
          <span className="font-semibold">
            {autoDue ? formatKoreanDate(autoDue) : hasDday ? "-" : "D-Day 미정 — 기본설정에서 지정"}
          </span>
        </span>
      )}
    </span>
  );
}
