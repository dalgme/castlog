"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/monitoring/report-client-error";

/**
 * 세그먼트 에러 바운더리 — 서버 컴포넌트·액션에서 처리되지 않은 예외를 잡는다.
 * 민감정보 유출 방지를 위해 화면에는 error.message를 노출하지 않는다(digest만).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // 모니터링 창이 열린 테넌트만 서버가 기록한다 — 조건 없이 보고
    reportClientError(error, "client");
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary/50 px-6 text-center">
      <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        요청을 처리하는 중 오류가 생겼습니다. 잠시 후 다시 시도해 주세요.
        문제가 계속되면 관리자에게 문의하세요.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          오류 코드: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={reset}>
          다시 시도
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/">처음으로</a>
        </Button>
      </div>
    </main>
  );
}
