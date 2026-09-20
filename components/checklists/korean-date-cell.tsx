"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKoreanDate, parseMonthDay, shiftYear, splitIso, toMonthDay } from "@/lib/checklists/dates";

/**
 * 월/일 입력 날짜 칸 (기획 지시 2026-09-20, 개정 같은 날).
 *
 * 항상 입력 칸이다 — 눌러서 여는 단계가 없다. 평소에는 "09월 06일(일)"이 칸 안에
 * 보이고, 칸에 들어가면 "9/6"으로 바뀌어 바로 고친다. 앞쪽에는 연도 자리가 비어
 * 있다가, 날짜를 치는 순간 연도와 −·+가 나타난다(기본은 시트 D-Day의 해).
 * Enter를 치면 저장하고 **아래 항목의 같은 칸**으로 커서가 내려간다 — 수십 줄의
 * 일정을 위에서 아래로 한 번에 친다. 형식이 틀리면 저장하지 않고 붉게 표시한다.
 */
export function KoreanDateCell({
  value,
  defaultYear,
  onCommit,
  disabled = false,
  className,
  ariaLabel,
  placeholder = "월/일",
  column,
  rowIndex,
}: {
  value: string | null;
  /** 값이 없을 때 월/일만 치면 붙는 연도 */
  defaultYear: number;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Enter로 아래 줄의 같은 칸으로 내려가기 위한 식별자 (열 이름 + 행 번호) */
  column?: string;
  rowIndex?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(toMonthDay(value));
  const [invalid, setInvalid] = useState(false);
  // 값이 없을 때 −·+로 미리 고른 연도 (첫 입력에 쓰인다)
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  // Enter로 저장한 직후 blur가 또 오면 같은 값을 두 번 보내지 않는다
  const lastCommitted = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setDraft(toMonthDay(value));
    setInvalid(false);
    lastCommitted.current = undefined;
  }, [value]);

  const year = splitIso(value)?.y ?? pendingYear ?? defaultYear;
  // 치는 중에 월/일이 읽히면 연도 자리가 채워진다
  const typedIso = focused ? parseMonthDay(draft, year) : null;
  const showYear = Boolean(value) || typedIso !== null || pendingYear !== null;

  /** 저장 — 성공하면 true (틀린 형식이면 false, 커서는 그대로) */
  function commit(): boolean {
    const text = draft.trim();
    if (text === "") {
      setInvalid(false);
      if (value !== null && lastCommitted.current !== null) {
        lastCommitted.current = null;
        onCommit(null);
      }
      return true;
    }
    const next = parseMonthDay(text, year);
    if (!next) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (next !== value && lastCommitted.current !== next) {
      lastCommitted.current = next;
      onCommit(next);
    }
    return true;
  }

  function focusBelow() {
    if (column === undefined || rowIndex === undefined) return;
    const el = document.querySelector<HTMLInputElement>(
      `input[data-datecol="${column}"][data-row="${rowIndex + 1}"]`
    );
    el?.focus();
    el?.select();
  }

  function bumpYear(delta: number) {
    if (value) {
      const next = shiftYear(value, delta);
      if (next) {
        lastCommitted.current = next;
        onCommit(next);
      }
      return;
    }
    const y = year + delta;
    if (y >= 2000 && y <= 2100) setPendingYear(y);
  }

  if (disabled) {
    return (
      <span className={cn("flex items-center gap-1 whitespace-nowrap text-xs", className)}>
        <span className="w-[4.25rem] shrink-0 text-[10px] text-muted-foreground">{value ? year : ""}</span>
        <span className={cn(!value && "text-muted-foreground")}>{value ? formatKoreanDate(value) : "-"}</span>
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1 whitespace-nowrap", className)}>
      {/* 연도 자리 — 비어 있다가 날짜를 치면 채워진다. 너비를 고정해 칸이 흔들리지 않게 */}
      <span className="inline-flex w-[4.25rem] shrink-0 items-center">
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
      </span>
      <input
        value={focused ? draft : value ? formatKoreanDate(value) : ""}
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        data-datecol={column}
        data-row={rowIndex}
        onFocus={(e) => {
          setFocused(true);
          setDraft(toMonthDay(value));
          // 들어가자마자 전체 선택 — 덮어쓰기가 기본 동작
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (commit()) focusBelow();
          }
          if (e.key === "Escape") {
            setDraft(toMonthDay(value));
            setInvalid(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        title={invalid ? "월/일 형식으로 입력하세요 (예: 9/6)" : "월/일로 입력 (예: 9/6) · Enter로 아래 칸"}
        className={cn(
          "w-full min-w-[6.5rem] rounded border bg-transparent px-1.5 py-0.5 text-xs outline-none",
          invalid ? "border-red-500 text-red-700" : "border-input/70 hover:border-input focus:border-brand focus:bg-white",
          !focused && !value && "text-muted-foreground"
        )}
      />
    </span>
  );
}
