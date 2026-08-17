"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  EXPERT_TAGS,
  EXPERT_TAG_LABELS,
  type ExpertTag,
} from "@/lib/integrations/expert-tags";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { setExpertTag } from "./tag-actions";

const NONE = "none";

/**
 * 전문가 등급 인라인 지정 (자사 기준 · 전문가 본인에게는 보이지 않는다).
 * '주의' 등급은 사유가 필수라 지정 시 한 번 입력받는다.
 */
export function ExpertTagCell({
  expertId,
  tag,
  note,
  canManage,
}: {
  expertId: string;
  tag: string | null;
  note: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(tag ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canManage) {
    const label = tag ? EXPERT_TAG_LABELS[tag as ExpertTag] : null;
    return (
      <span className="text-sm text-muted-foreground" title={note ?? undefined}>
        {label ?? "-"}
      </span>
    );
  }

  function onChange(next: string) {
    if (next === value) return;
    setError(null);

    let reason: string | undefined;
    if (next === "caution") {
      const input = window.prompt(
        "‘주의’ 등급 사유를 입력하세요 (섭외 후보군 화면에 함께 표시됩니다)",
        note ?? ""
      );
      if (input === null) return; // 취소
      if (!input.trim()) {
        setError("사유를 입력해야 합니다.");
        return;
      }
      reason = input.trim();
    }

    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await setExpertTag(
        expertId,
        next === NONE ? "" : next,
        reason
      );
      if (res.ok) router.refresh();
      else {
        setValue(previous);
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="h-8 w-[108px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>미지정</SelectItem>
          {EXPERT_TAGS.map((t) => (
            <SelectItem key={t} value={t}>
              {EXPERT_TAG_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {note && value === "caution" && (
        <p className="max-w-[160px] truncate text-[11px] text-destructive" title={note}>
          {note}
        </p>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
