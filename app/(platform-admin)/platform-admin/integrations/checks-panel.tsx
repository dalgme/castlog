"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, MinusCircle, PlayCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConnectionCheck } from "@/lib/integrations/connection-checks";

import { runChecks } from "./actions";

const STATUS_META = {
  ok: {
    label: "정상",
    icon: CheckCircle2,
    dot: "bg-emerald-600",
    text: "text-emerald-700",
    card: "border-emerald-300",
  },
  failed: {
    label: "오류",
    icon: XCircle,
    dot: "bg-destructive",
    text: "text-destructive",
    card: "border-destructive/50",
  },
  not_configured: {
    label: "미설정",
    icon: MinusCircle,
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    card: "border-dashed",
  },
} as const;

/**
 * 외부 연동 점검 화면.
 *
 * 환경변수를 Vercel에 넣고 재배포한 뒤, 제대로 들어갔는지 확인할 곳이 필요하다.
 * 여기서 버튼 하나로 실제 호출을 해 보고, 실패하면 **그 API가 돌려준 사유를
 * 그대로** 보여 준다 — '연결 실패'로 뭉개면 키가 문제인지 이용 신청이 문제인지
 * 알 수 없어 고칠 수가 없다.
 */
export function ChecksPanel({
  summary,
}: {
  /** 화면 진입 시점의 설정 여부 (호출 없이 환경변수만 확인) */
  summary: { key: string; label: string; configured: boolean }[];
}) {
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await runChecks();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChecks(res.checks);
      setRanAt(res.ranAt);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-semibold">환경변수 등록 상태</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Vercel에 키가 들어와 있는지만 봅니다. 실제로 동작하는지는 아래에서
            점검하세요.
          </p>
          <ul className="mt-3 space-y-1.5">
            {summary.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    s.configured ? "bg-emerald-600" : "bg-muted-foreground/40"
                  )}
                />
                <span className="min-w-0 flex-1">{s.label}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    s.configured ? "text-emerald-700" : "text-muted-foreground"
                  )}
                >
                  {s.configured ? "등록됨" : "미등록"}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={pending}>
          <PlayCircle className="mr-1.5 h-4 w-4" />
          {pending ? "점검 중…" : "연동 점검 실행"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {ranAt
            ? `마지막 점검 ${new Date(ranAt).toLocaleString("ko-KR")}`
            : "각 서비스를 실제로 한 번씩 호출합니다. 소액의 호출 비용이 발생할 수 있습니다."}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {checks && (
        <ul className="space-y-2">
          {checks.map((check) => {
            const meta = STATUS_META[check.status];
            const Icon = meta.icon;
            return (
              <li
                key={check.key}
                className={cn("rounded-lg border bg-white p-3", meta.card)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className={cn("h-4 w-4 shrink-0", meta.text)} aria-hidden />
                  <p className="min-w-0 flex-1 text-sm font-semibold">
                    {check.label}
                  </p>
                  <span className={cn("shrink-0 text-xs font-bold", meta.text)}>
                    {meta.label}
                  </span>
                </div>

                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {check.purpose}
                </p>

                {check.detail && (
                  <p className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900">
                    {check.detail}
                  </p>
                )}
                {check.reason && (
                  <p className="mt-1.5 rounded-md bg-destructive/5 px-2.5 py-1.5 text-xs leading-relaxed text-destructive">
                    {check.reason}
                  </p>
                )}

                <p className="mt-1.5 flex flex-wrap gap-1">
                  {check.envKeys.map((k) => (
                    <code
                      key={k}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[11px]"
                    >
                      {k}
                    </code>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
