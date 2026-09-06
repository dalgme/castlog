"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 표 안에서 바로 고치는 칸 — 포커스를 잃거나 Enter를 누르면 저장한다.
 * 값이 그대로면 저장하지 않는다. 저장 중에는 흐리게 보인다.
 */
export function EditableText({
  value,
  onSave,
  placeholder,
  multiline = false,
  disabled = false,
  className,
  inputClassName,
  type = "text",
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void> | void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  type?: "text" | "number" | "date";
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    const next = draft.trim() === "" ? null : draft.trim();
    if ((value ?? null) === next) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return (
      <span className={cn("block whitespace-pre-wrap text-xs", className)}>
        {value ?? <span className="text-muted-foreground">{placeholder ?? "-"}</span>}
      </span>
    );
  }

  const base =
    "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-input focus:border-brand focus:bg-white";
  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={Math.min(6, Math.max(1, draft.split("\n").length))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        placeholder={placeholder}
        className={cn(base, "resize-y leading-snug", saving && "opacity-60", inputClassName)}
      />
    );
  }
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value ?? "");
      }}
      placeholder={placeholder}
      className={cn(base, saving && "opacity-60", inputClassName)}
    />
  );
}

/**
 * 날짜 칸 — 브라우저 date 입력은 자릿수를 채울 때마다 change가 나므로(2026을
 * 치는 동안 0002·0020·0202·2026) 칸을 벗어날 때만 저장한다 (리뷰 H3).
 */
export function DateCell({
  value,
  onCommit,
  disabled = false,
  className,
  ariaLabel,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
  return (
    <input
      type="date"
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft || null;
        if (next !== (value ?? null)) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value ?? "");
      }}
      className={cn(
        "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-input focus:border-brand disabled:opacity-100",
        className
      )}
    />
  );
}
