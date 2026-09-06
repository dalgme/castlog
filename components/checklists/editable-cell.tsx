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
