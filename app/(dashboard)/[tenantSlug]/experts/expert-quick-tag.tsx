"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crown, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { expertTagLabel } from "@/lib/integrations/expert-tags";
import { useToast } from "@/hooks/use-toast";
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
  tagNote = null,
  target,
  canManage,
  linkActive = true,
}: {
  expertId: string;
  expertName: string;
  /** 현재 등급 (favorite/vip/caution/null) */
  tag: string | null;
  /** '주의' 사유 — 주의 버튼 툴팁에 보여 준다 */
  tagNote?: string | null;
  /** 이 버튼이 토글하는 등급 */
  target: "favorite" | "vip" | "caution";
  canManage: boolean;
  /**
   * 자사와 활성 연결된 전문가인가 — 미연결은 권한 문제가 아니라 상태
   * 미충족이다. 툴팁에서 두 원인을 구분한다 (§12-9 — 리뷰 P3-2).
   */
  linkActive?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = tag === target;
  const targetLabel =
    target === "favorite" ? "즐겨찾기" : target === "vip" ? "VIP" : "주의";
  const enabled = canManage && linkActive;

  function toggle() {
    if (!enabled || pending) return;
    if (!active && tag && tag !== target) {
      const ok = window.confirm(
        `${expertName} 전문가의 현재 등급(${expertTagLabel(tag) ?? tag})을 '${targetLabel}'로 바꿀까요?`
      );
      if (!ok) return;
    }
    // '주의'는 사유가 필수다 — 섭외 후보군 화면에 함께 표시된다 (기획 23번)
    let reason: string | undefined;
    if (!active && target === "caution") {
      const input = window.prompt(
        "‘주의’ 지정 사유를 입력하세요 (섭외 후보군 화면에 함께 표시됩니다)",
        tagNote ?? ""
      );
      if (input === null) return; // 취소
      if (!input.trim()) {
        toast({ variant: "destructive", description: "사유를 입력해야 합니다." });
        return;
      }
      reason = input.trim();
    }
    setError(null);
    startTransition(async () => {
      const result = await setExpertTag(expertId, active ? "" : target, reason);
      if (!result.ok) {
        setError(result.error);
        toast({ variant: "destructive", description: result.error });
      } else {
        router.refresh();
      }
    });
  }

  // 원인 분류 (§12-9): 권한 거부와 상태 미충족(미연결)은 다른 문제다
  const title = !canManage
    ? `${targetLabel} 지정 권한이 없습니다 (권한 규칙)`
    : !linkActive
      ? `${targetLabel}는 우리 회사와 연결된 전문가만 지정할 수 있습니다 (미연결 상태)`
      : active
        ? `${targetLabel} 해제`
        : `${targetLabel}로 지정`;

  if (target === "favorite") {
    return (
      <button
        type="button"
        aria-label={title}
        title={error ?? title}
        disabled={!enabled || pending}
        onClick={toggle}
        className={cn(
          "mr-1 inline-flex shrink-0 rounded p-0.5 align-middle transition-colors",
          enabled ? "hover:text-amber-500" : "cursor-default opacity-40",
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

  if (target === "caution") {
    // 활성 시 빨간 배경 (기획 지시 2026-08-30 — 23번)
    return (
      <button
        type="button"
        aria-label={title}
        title={error ?? (active && tagNote ? `주의: ${tagNote}` : title)}
        disabled={!enabled || pending}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
          active
            ? "border-red-600 bg-red-600 text-white"
            : enabled
              ? "border-red-200 text-red-600 hover:bg-red-50"
              : "cursor-default border-muted text-muted-foreground/50"
        )}
      >
        <AlertTriangle
          className="h-3 w-3"
          fill={active ? "currentColor" : "none"}
          aria-hidden
        />
        주의
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={title}
      title={error ?? title}
      disabled={!enabled || pending}
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
        active
          ? "border-violet-500 bg-violet-500 text-white"
          : enabled
            ? "border-violet-200 text-violet-600 hover:bg-violet-50"
            : "cursor-default border-muted text-muted-foreground/50"
      )}
    >
      <Crown className="h-3 w-3" fill={active ? "currentColor" : "none"} aria-hidden />
      VIP
    </button>
  );
}
