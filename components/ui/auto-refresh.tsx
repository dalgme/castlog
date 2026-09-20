"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 서버 컴포넌트 화면을 주기적으로 다시 그린다 (router.refresh — 데이터 페칭은
 * 서버 컴포넌트가 한다, §9). 전문가가 문자 링크에서 수락·거절하면 담당자 화면이
 * 새로고침 없이 따라오게 하는 용도 (기획 지시 2026-09-21). 탭이 보이지 않을 때는
 * 쉬고, 다시 보이거나 창이 포커스를 얻으면 즉시 한 번 갱신한다.
 */
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [router, intervalMs]);
  return null;
}
