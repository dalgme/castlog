"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatKoreanDateFull, parseMonthDay, splitIso, toMonthDay } from "@/lib/checklists/dates";

function kstYear(): number {
  return Number(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4));
}

/**
 * 플랫폼 공통 날짜 입력 (기획 지시 2026-09-21).
 *
 * - 평소에는 "2026년 09월 06일(토)"로 보이고, 칸을 클릭하면 "9/6"으로 바뀌어 바로 고친다.
 *   "09/12"·"9/12"·"0912"·"2026-09-12" 모두 받는다. 월/일만 치면 연도는 현재 값의 해
 *   (없으면 defaultYear, 그도 없으면 올해)가 붙는다.
 * - 오른쪽 달력 단추를 누르면 브라우저 달력이 열린다(네이티브 date 입력을 단추 위에 겹쳐 둔다).
 * - 값은 늘 ISO(YYYY-MM-DD) 또는 빈 문자열 — 기존 폼·서버 액션 계약과 같다.
 * - `name`을 주면 같은 값의 hidden 입력을 함께 내보내 method="get" 폼에서도 쓸 수 있다.
 */
export function KoreanDateInput({
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled = false,
  required,
  className,
  inputClassName,
  ariaLabel,
  placeholder = "월/일 (예: 9/12)",
  min,
  max,
  defaultYear,
  size = "md",
}: {
  /** 제어 값 (ISO 또는 ""). 주지 않으면 defaultValue로 시작하는 비제어 입력 */
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  /** method="get" 폼 등 — hidden 입력 이름 */
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  /** 월/일만 쳤을 때 붙는 연도 (기본: 현재 값의 해 → 올해) */
  defaultYear?: number;
  size?: "sm" | "md";
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const cur = controlled ? value : inner;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setInvalid(false);
  }, [cur, focused]);

  const year = splitIso(cur)?.y ?? defaultYear ?? kstYear();

  function emit(next: string) {
    if (!controlled) setInner(next);
    if (next !== cur) onChange?.(next);
  }

  function commit(): boolean {
    const text = draft.trim();
    if (text === "") {
      setInvalid(false);
      emit("");
      return true;
    }
    const next = parseMonthDay(text, year);
    if (!next) {
      setInvalid(true);
      return false;
    }
    if ((min && next < min) || (max && next > max)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    emit(next);
    return true;
  }

  const h = size === "sm" ? "h-8" : "h-9";
  const text = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span className={cn("relative inline-flex w-full max-w-[16rem] items-stretch", className)}>
      {name && <input type="hidden" name={name} value={cur} />}
      <input
        ref={textRef}
        id={id}
        value={focused ? draft : cur ? formatKoreanDateFull(cur) : ""}
        disabled={disabled}
        required={required}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        title={invalid ? "월/일 형식으로 입력하세요 (예: 9/12)" : "월/일로 입력하거나(예: 9/12) 달력 단추로 선택"}
        onFocus={(e) => {
          setFocused(true);
          setDraft(toMonthDay(cur));
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
            if (commit()) (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(toMonthDay(cur));
            setInvalid(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "w-full rounded-md rounded-r-none border border-input bg-background px-2.5 py-1 outline-none placeholder:text-muted-foreground/70 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60",
          h,
          text,
          invalid && "border-red-500 text-red-700",
          inputClassName
        )}
      />
      {/* 달력 단추 — 네이티브 date 입력을 투명하게 겹쳐 두면 어느 브라우저에서나 클릭으로 달력이 열린다 */}
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-r-md border border-l-0 border-input bg-secondary/60 px-2 text-muted-foreground",
          h,
          disabled ? "opacity-60" : "hover:text-brand"
        )}
        title="달력에서 선택"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        <input
          type="date"
          tabIndex={-1}
          aria-label={`${ariaLabel ?? "날짜"} 달력`}
          value={cur}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            // 자릿수를 치는 동안 change가 여러 번 나는 브라우저가 있다 — 완성된 값만 받는다
            if (e.target.value === "" || splitIso(e.target.value)) emit(e.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
    </span>
  );
}
