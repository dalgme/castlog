"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import { setExpertTag } from "./tag-actions";

/**
 * 전문가 목록의 빠른 등급 토글 (기획 확정 2026-08-23).
 * - 이름 앞 별 = 즐겨찾기 토글
 * - 행 오른쪽 끝 VIP 버튼 = VIP 토글
 * 등급은 전문가당 하나(즐겨찾기/VIP/주의)라, 다른 등급이 붙어 있으면
 * 바꿀지 확인을 받는다 — 특히 '주의'는 사유까지 지워지므로 조용히 덮지 않는다.
 */
export function ExpertQuickTag({
  expertId,
  expertName,
  tag,
  target,
  canManage,
}: {
  expertId: string;
  expertName: string;
  /** 현재 등급 (favorite/vip/caution/null) */
  tag: string | null;
  /** 이 버튼이 토글하는 등급 */
  target: "favorite" | "vip";
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = tag === target;
  const targetLabel = target === "favorite" ? "즐겨찾기" : "VIP";

  function toggle() {
    if (!canManage || pending) return;
    if (!active && tag && tag !== target) {
      const ok = window.confirm(
        `${expertName} 전문가의 현재 등급(${expertTagLabel(tag) ?? tag})을 '${targetLabel}'로 바꿀까요?`
      );
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setExpertTag(expertId, active ? "" : target);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const title = !canManage
    ? `${targetLabel} 지정 권한이 없습니다 (권한 규칙)`
    : active
      ? `${targetLabel} 해제`
      : `${targetLabel}로 지정`;

  if (target === "favorite") {
    return (
      <button
        type="button"
        aria-label={title}
        title={error ?? title}
        disabled={!canManage || pending}
        onClick={toggle}
        className={cn(
          "mr-1 inline-flex shrink-0 rounded p-0.5 align-middle transition-colors",
          canManage ? "hover:text-amber-500" : "cursor-default opacity-40",
          active ? "text-amber-500" : "text-muted-foreground/40"
        )}
      >
        <Star
          className="h-4 w-4"
          fill={active ? "currentColor" : "none"}
          aria-hidden
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={title}
      title={error ?? title}
      disabled={!canManage || pending}
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
        active
          ? "border-violet-500 bg-violet-500 text-white"
          : canManage
            ? "border-violet-200 text-violet-600 hover:bg-violet-50"
            : "cursor-default border-muted text-muted-foreground/50"
      )}
    >
      <Crown className="h-3 w-3" fill={active ? "currentColor" : "none"} aria-hidden />
      VIP
    </button>
  );
}
