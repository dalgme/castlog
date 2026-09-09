"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatMoney, formatQty, parseMoney } from "@/lib/quotes/calc";

/**
 * 금액·수량 입력 — 보고 있을 때는 1,000 단위 쉼표, 고칠 때는 숫자만
 * (기획 지시 01: 1000단위 자동 쉼표). 저장은 칸을 벗어날 때 한 번만 —
 * 자릿수를 채우는 동안 매번 저장하면 중간 값이 로그에 쌓인다.
 */
export function MoneyInput({
  value,
  onCommit,
  disabled = false,
  align = "right",
  className,
  ariaLabel,
  placeholder,
  decimals = false,
}: {
  value: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
  align?: "left" | "right";
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** 수량·횟수·일수처럼 소수가 의미를 갖는 칸 — 반올림해 보여주지 않는다 */
  decimals?: boolean;
}) {
  const show = decimals ? formatQty : formatMoney;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value);

  useEffect(() => {
    committed.current = value;
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  if (disabled) {
    return (
      <span className={cn("block px-1 py-0.5 text-xs tabular-nums", align === "right" && "text-right", className)}>
        {show(value)}
      </span>
    );
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={focused ? draft : show(value)}
      onFocus={() => {
        setDraft(value === 0 ? "" : String(value));
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const next = draft.trim() === "" ? 0 : parseMoney(draft);
        if (next !== committed.current) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(String(committed.current));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs tabular-nums outline-none hover:border-input focus:border-brand focus:bg-white",
        align === "right" && "text-right",
        className
      )}
    />
  );
}

/** 비율 입력 — 화면은 %(5), 저장은 소수(0.05) */
export function PercentInput({
  value,
  onCommit,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 10000) / 100));
  useEffect(() => {
    setDraft(String(Math.round(value * 10000) / 100));
  }, [value]);
  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const pct = parseMoney(draft);
          const next = Math.min(1, Math.max(0, pct / 100));
          if (Math.abs(next - value) > 1e-9) onCommit(next);
          else setDraft(String(Math.round(value * 10000) / 100));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-xs tabular-nums outline-none hover:border-input focus:border-brand focus:bg-white disabled:opacity-100"
      />
      <span className="text-xs text-muted-foreground">%</span>
    </span>
  );
}
