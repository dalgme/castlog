"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 천단위 콤마 자동 표시 숫자 입력 (기획 확정 2026-08-23).
 *
 * 화면에는 1,000,000처럼 보이고, 밖으로는 콤마 없는 숫자 문자열("1000000")을
 * 넘긴다 — 기존 폼·서버 액션이 문자열 숫자를 그대로 쓰고 있으므로 값 계약은
 * 바꾸지 않는다. type="number"는 콤마를 못 넣으므로 text + inputMode를 쓴다.
 */
export function CommaNumberInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  /** 콤마 없는 숫자 문자열 (빈 값 허용) */
  value: string;
  onValueChange: (raw: string) => void;
}) {
  const display = value === "" ? "" : formatComma(value);
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cn("tabular-nums", className)}
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d]/g, "");
        onValueChange(raw);
      }}
    />
  );
}

function formatComma(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}
