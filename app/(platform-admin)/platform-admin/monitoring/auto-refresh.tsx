"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * 활동 피드 자동 새로고침 — 15초마다 서버 컴포넌트를 다시 그린다.
 *
 * 이 코드베이스는 실시간 채널 선례가 없다(§2 기술 스택 고정). 서버 컴포넌트
 * 렌더 + router.refresh()가 확립된 갱신 관례이므로, 타이머로 그 관례를 도는
 * 것이 가장 작은 신기술이다. §11-10(useEffect+fetch)은 데이터 페칭 금지다 —
 * 여기는 fetch가 아니라 라우터 갱신이며, 데이터는 서버 컴포넌트가 가져온다.
 *
 * 탭이 보이지 않는 동안은 멈춘다 — 관리자가 다른 탭에서 일하는 동안
 * 서버를 계속 두드릴 이유가 없다.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.hidden) return;
      router.refresh();
      setLastAt(new Date());
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, router]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={
          enabled
            ? "inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500"
            : "inline-block h-2 w-2 rounded-full bg-muted-foreground/40"
        }
        aria-hidden
      />
      {enabled ? "15초마다 자동 갱신" : "자동 갱신 멈춤"}
      {lastAt && (
        <span>
          · 마지막{" "}
          {lastAt.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => setEnabled((v) => !v)}
      >
        {enabled ? "멈춤" : "재개"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => {
          router.refresh();
          setLastAt(new Date());
        }}
      >
        지금 갱신
      </Button>
    </div>
  );
}
