"use client";

import { useState, useTransition } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { resolveLockdownAction } from "./lockdown-actions";

/**
 * 주민번호 전체 잠금 상태 + 해제 (플랫폼 운영자 전용).
 * 허니토큰 감지 등으로 잠금되면 모든 주민번호 조회가 차단된다.
 */
export function LockdownPanel({
  locked,
  reason,
  triggeredAt,
}: {
  locked: boolean;
  reason?: string;
  triggeredAt?: string;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onResolve = () => {
    setError(null);
    startTransition(async () => {
      const r = await resolveLockdownAction(note);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <Card className={locked ? "border-red-300" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {locked ? (
            <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden />
          ) : (
            <ShieldCheck className="h-4 w-4 text-green-600" aria-hidden />
          )}
          주민번호 조회 보안 상태
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!locked ? (
          <p className="text-sm text-muted-foreground">
            정상. 허니토큰 감지·수동 잠금 시 이곳에서 해제할 수 있습니다.
          </p>
        ) : (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertDescription>
                <b>전체 잠금 중</b> — 모든 주민번호 조회가 차단되었습니다.
                <br />
                사유: {reason === "honeytoken" ? "허니토큰 접근 감지" : reason}
                {triggeredAt && (
                  <> · {new Date(triggeredAt).toLocaleString("ko-KR")}</>
                )}
              </AlertDescription>
            </Alert>
            <p className="text-xs text-muted-foreground">
              원인(비정상 접근 여부)을 확인한 뒤 사유를 남기고 해제하세요.
            </p>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="해제 사유 / 원인 확인 내용"
            />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button variant="outline" onClick={onResolve} disabled={pending}>
              {pending ? "해제 중..." : "잠금 해제"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
