"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ArrowLeftRight } from "lucide-react";

import {
  enterPlatformAdminMode,
  exitPlatformAdminMode,
} from "@/lib/auth/platform-mode-actions";

/**
 * 관리모드 전환 버튼 — 넥스트랩 운영자만 보인다.
 *
 * 성공하면 서버 액션이 그대로 리다이렉트하므로 이 컴포넌트는 아무것도 하지
 * 않는다. 실패했을 때만 **이유를 화면에 남긴다** — 눌렀는데 아무 일도 일어나지
 * 않으면 사용자는 시스템이 고장 났다고 생각한다.
 */
export function PlatformModeButton({ mode }: { mode: "enter" | "exit" }) {
  const enter = mode === "enter";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = enter
        ? await enterPlatformAdminMode()
        : await exitPlatformAdminMode();
      // 성공 경로는 리다이렉트로 끝나므로 여기 오지 않는다
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title={
          enter
            ? "캐스트로그 관리모드로 전환합니다 (테넌트·모듈 관리)"
            : "원래 회사 화면으로 돌아갑니다"
        }
        className={
          enter
            ? "inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-navy bg-brand-navy px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium text-brand-navy transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
        }
      >
        {enter ? (
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? "전환 중…" : enter ? "관리자 모드" : "기업 모드로"}
      </button>

      {error && (
        <div
          role="alert"
          className="absolute right-0 top-9 z-50 w-72 rounded-lg border border-destructive/40 bg-white p-3 text-xs leading-relaxed text-destructive shadow-lg"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-1.5 block text-[11px] underline"
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
