"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { runUsageSnapshot } from "./actions";

/** 사용량 스냅샷 수동 실행 버튼 — 결과는 서버 revalidate로 갱신 */
export function SnapshotButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onRun() {
    setMessage(null);
    startTransition(async () => {
      const result = await runUsageSnapshot();
      setMessage(
        result.ok
          ? `${result.tenants}개 테넌트 집계 완료`
          : result.error
      );
    });
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="text-sm text-muted-foreground">{message}</span>
      )}
      <Button size="sm" variant="outline" onClick={onRun} disabled={pending}>
        <RefreshCw className="mr-1.5 h-4 w-4" />
        {pending ? "집계 중..." : "지금 집계"}
      </Button>
    </div>
  );
}
