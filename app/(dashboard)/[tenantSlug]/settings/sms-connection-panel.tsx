"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { setSmsConfigActive, testSmsConfig } from "./actions";

/**
 * SMS 연결 상태 · 연결 테스트 · 발송 활성/비활성 (대표 전용).
 *
 * 설정만 저장하고 동작 여부를 모르면 실운영에서 첫 섭외요청이 조용히 실패한다.
 * 대표가 자기 번호로 즉시 확인할 수 있게 한다.
 */
export function SmsConnectionPanel({
  configured,
  isActive,
  provider,
  senderNumber,
}: {
  configured: boolean;
  isActive: boolean;
  provider: string | null;
  senderNumber: string | null;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!configured) {
    return (
      <Alert>
        <AlertDescription>
          아직 공급자 설정이 저장되지 않았습니다. 아래에서 API 키와 발신번호를
          등록하면 연결 테스트를 할 수 있습니다.
        </AlertDescription>
      </Alert>
    );
  }

  function runTest() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await testSmsConfig(phone);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        res.testMode
          ? "서버가 테스트 모드(SMS_TEST_MODE)라 실제 문자는 나가지 않았습니다. 발송 이력에는 기록됩니다."
          : "테스트 문자를 발송했습니다. 휴대폰을 확인해 주세요."
      );
      router.refresh();
    });
  }

  function toggleActive() {
    const next = !isActive;
    if (
      !next &&
      !window.confirm(
        "발송을 비활성화하면 섭외요청·안내문자가 나가지 않습니다. 계속할까요?"
      )
    ) {
      return;
    }
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await setSmsConfigActive(next);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
        {isActive ? (
          <Badge className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            발송 활성
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            발송 중지됨
          </Badge>
        )}
        <span className="text-muted-foreground">
          {provider} · 발신번호 {senderNumber}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={pending}
          onClick={toggleActive}
        >
          {isActive ? "발송 중지" : "발송 활성화"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {done && (
        <Alert>
          <AlertDescription>{done}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">연결 테스트</label>
        <div className="flex gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="테스트 수신 휴대폰 (예: 01012345678)"
            inputMode="numeric"
          />
          <Button
            size="sm"
            disabled={pending || !phone.trim()}
            onClick={runTest}
          >
            <Send className="mr-1 h-3.5 w-3.5" />
            {pending ? "발송 중..." : "테스트 발송"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          입력한 번호로 실제 1건이 발송되며 요금이 부과됩니다. 발송 이력은 ‘발송’
          메뉴에서 확인할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
