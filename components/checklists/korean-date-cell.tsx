"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKoreanDate, parseMonthDay, shiftYear, splitIso, toMonthDay } from "@/lib/checklists/dates";

/**
 * 월/일 입력 날짜 칸 (기획 지시 2026-09-20).
 *
 * 평소에는 "09월 06일(금)"으로 보이고, 누르면 "9/6"을 고치는 칸이 된다. 날짜를
 * 넣으면 앞의 연도 칸이 자동으로 채워지고(기본은 시트의 D-Day 해), 연도는 −·+로만
 * 바꾼다. 칸을 벗어나거나 Enter를 누를 때 저장하고, 형식이 틀리면 저장하지 않고
 * 붉게 표시한다 — 잘못 읽힌 날짜가 조용히 들어가는 것보다 낫다.
 */
export function KoreanDateCell({
  value,
  defaultYear,
  onCommit,
  disabled = false,
  className,
  ariaLabel,
  placeholder = "월/일",
}: {
  value: string | null;
  /** 값이 없을 때 월/일만 치면 붙는 연도 */
  defaultYear: number;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(toMonthDay(value));
  const [invalid, setInvalid] = useState(false);
  // 값이 없을 때 −·+로 미리 고른 연도 (첫 입력에 쓰인다)
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  useEffect(() => {
    setDraft(toMonthDay(value));
    setInvalid(false);
  }, [value]);

  const year = splitIso(value)?.y ?? pendingYear ?? defaultYear;

  function commit() {
    const text = draft.trim();
    if (text === "") {
      setEditing(false);
      setInvalid(false);
      if (value !== null) onCommit(null);
      return;
    }
    const next = parseMonthDay(text, year);
    if (!next) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    if (next !== value) onCommit(next);
  }

  function bumpYear(delta: number) {
    if (value) {
      const next = shiftYear(value, delta);
      if (next) onCommit(next);
      return;
    }
    const y = year + delta;
    if (y >= 2000 && y <= 2100) setPendingYear(y);
  }

  if (disabled) {
    return (
      <span className={cn("block whitespace-nowrap text-xs", className)}>
        {value ? (
          <>
            <span className="mr-1 text-[10px] text-muted-foreground">{year}</span>
            {formatKoreanDate(value)}
          </>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </span>
    );
  }

  const showYear = Boolean(value) || editing || pendingYear !== null;

  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", className)}>
      {showYear && (
        <span className="inline-flex items-center rounded border border-input bg-white text-[10px] leading-none text-muted-foreground">
          <button
            type="button"
            tabIndex={-1}
            aria-label="연도 1년 전"
            className="px-0.5 py-0.5 hover:text-brand"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => bumpYear(-1)}
          >
            <Minus className="h-2.5 w-2.5" aria-hidden />
          </button>
          <span className="px-0.5 tabular-nums">{year}</span>
          <button
            type="button"
            tabIndex={-1}
            aria-label="연도 1년 후"
            className="px-0.5 py-0.5 hover:text-brand"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => bumpYear(1)}
          >
            <Plus className="h-2.5 w-2.5" aria-hidden />
          </button>
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          inputMode="numeric"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(toMonthDay(value));
              setInvalid(false);
              setEditing(false);
            }
          }}
          title={invalid ? "월/일 형식으로 입력하세요 (예: 9/6)" : undefined}
          className={cn(
            "w-14 rounded border bg-white px-1 py-0.5 text-xs outline-none focus:border-brand",
            invalid ? "border-red-500 text-red-700" : "border-input"
          )}
        />
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          title="눌러서 월/일 입력 (예: 9/6)"
          onClick={() => {
            setDraft(toMonthDay(value));
            setEditing(true);
          }}
          className={cn(
            "rounded border border-transparent px-1 py-0.5 text-left text-xs hover:border-input",
            !value && "text-muted-foreground"
          )}
        >
          {value ? formatKoreanDate(value) : placeholder}
        </button>
      )}
    </span>
  );
}
