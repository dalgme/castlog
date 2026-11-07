"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLIENT_NAME_MAX_COUNT,
  CLIENT_NAME_MAX_EACH,
  joinClientNames,
  splitClientNames,
} from "@/lib/operations/client-names";

/**
 * 발주처 여러 곳 입력 (기획 지시 2026-11-07) — 한 칸씩 적고 '발주처 추가'로 칸을 늘린다.
 * 폼 값(value)은 ' · '로 이어진 한 문자열이라 기존 스키마·저장 경로를 그대로 쓴다.
 */
export function ClientNamesInput({
  value,
  onChange,
  placeholder = "OO창조경제혁신센터",
  disabled = false,
  invalid = false,
}: {
  value: string;
  onChange: (joined: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const fromValue = (v: string) => {
    const names = splitClientNames(v);
    return names.length > 0 ? names : [""];
  };
  const [entries, setEntries] = useState<string[]>(() => fromValue(value));
  // 폼 reset 등 바깥에서 값이 바뀌면 칸을 다시 만든다 (내가 보낸 값과 다를 때만)
  const lastEmitted = useRef(value);
  if (value !== lastEmitted.current) {
    lastEmitted.current = value;
    setEntries(fromValue(value));
  }

  function emit(next: string[]) {
    setEntries(next);
    const joined = joinClientNames(next);
    lastEmitted.current = joined;
    onChange(joined);
  }

  return (
    <div className="space-y-1.5">
      {entries.map((name, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={name}
            maxLength={CLIENT_NAME_MAX_EACH}
            placeholder={i === 0 ? placeholder : `발주처 ${i + 1}`}
            disabled={disabled}
            aria-label={`발주처 ${i + 1}`}
            aria-invalid={invalid && i === 0 ? true : undefined}
            onChange={(e) => {
              const next = [...entries];
              next[i] = e.target.value;
              emit(next);
            }}
          />
          {entries.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              disabled={disabled}
              aria-label={`발주처 ${i + 1} 삭제`}
              onClick={() => emit(entries.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      ))}
      {entries.length < CLIENT_NAME_MAX_COUNT && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled || entries[entries.length - 1]?.trim() === ""}
          onClick={() => emit([...entries, ""])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> 발주처 추가
        </Button>
      )}
      {entries.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          여러 발주처는 ‘{entries.filter((e) => e.trim()).join(" · ")}’처럼 함께 표시됩니다.
        </p>
      )}
    </div>
  );
}
