"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpNarrowWide } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { setPlanRelayEnabled } from "./actions";

/**
 * 상급자 릴레이 결재 스위치 (기획 확정 2026-08-30 — 27번).
 * 대표·'전결규정' 위임자에게만 렌더링된다 (서버 액션이 다시 검증).
 */
export function PlanRelayToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await setPlanRelayEnabled(!enabled);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowUpNarrowWide className="h-4 w-4" aria-hidden />
          섭외계획 품의 — 상급자 릴레이 결재
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              enabled
                ? "bg-emerald-600 text-white"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {enabled ? "사용 중" : "꺼짐"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          켜면 섭외계획 품의(최초·변경)의 결재선이 <b>직급 단계</b>로 구성됩니다
          — 상신자의 상급 직급마다 한 단계씩, <b>그 직급 이상 누구나</b> 결재할
          수 있고, 결재하면 다음 상급 직급 차례가 자동으로 열립니다(마지막은
          대표). 결재라인을 직접 지정한 상신은 그 지정이 우선하며, 이 스위치가
          켜져 있는 동안 섭외계획 품의에는 전결규정 대신 릴레이가 적용됩니다.
        </p>
        <Button size="sm" variant={enabled ? "outline" : "default"} onClick={toggle} disabled={pending}>
          {pending ? "저장 중..." : enabled ? "릴레이 결재 끄기" : "릴레이 결재 켜기"}
        </Button>
      </CardContent>
    </Card>
  );
}
