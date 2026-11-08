"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { setPersonalMailAllowed } from "./actions";

/**
 * 직원 개인 메일 계정 발송 허용 (기획 지시 2026-11-08 — 렛츠 요구).
 * 켜면 직원 각자가 설정 > 내 설정에서 자기 메일 계정을 연결할 수 있고, 연결한 직원의 섭외·수락서 메일은
 * 그 계정에서 나간다. 연결하지 않은 직원·실패 시는 지금처럼 플랫폼 계정(회사명·담당자 표시)으로 나간다.
 */
export function PersonalMailPanel({ ready, allowed, connectedCount }: { ready: boolean; allowed: boolean; connectedCount: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    if (!next && connectedCount > 0 && !window.confirm(`연결된 직원 ${connectedCount}명의 개인 계정 발송이 중단되고 플랫폼 계정으로 나갑니다. 끌까요?`)) return;
    startTransition(async () => {
      const r = await setPersonalMailAllowed(next);
      if (!r.ok) setError(r.error);
      else {
        toast({ description: next ? "직원 개인 계정 발송을 허용했습니다. 직원은 설정 > 내 설정에서 계정을 연결합니다." : "직원 개인 계정 발송을 껐습니다." });
        router.refresh();
      }
    });
  }

  if (!ready) {
    return <p className="text-sm text-muted-foreground">이 기능은 데이터베이스 마이그레이션 0018 적용 뒤 열립니다.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">직원 개인 계정 발송</span>
        {allowed ? <Badge className="bg-emerald-600 hover:bg-emerald-600">허용 · 연결 {connectedCount}명</Badge> : <Badge variant="outline">허용 안 함</Badge>}
        <Button type="button" size="sm" variant={allowed ? "outline" : "default"} className="ml-auto" disabled={pending} onClick={() => toggle(!allowed)}>
          {allowed ? "끄기" : "허용하기"}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        허용하면 직원 각자가 <b>설정 &gt; 내 설정 &gt; 내 메일 계정으로 발송</b>에서 자기 메일(네이버웍스·Google 등) 계정과 앱 비밀번호를 연결합니다.
        연결한 직원이 보내는 섭외 요청·수락서 안내 메일은 그 직원 계정에서 나가고 보낸편지함에도 남습니다. 연결하지 않았거나 발송에 실패하면 플랫폼 계정(회사명 · 담당자 표시)으로 나갑니다.
        개인 계정 발송은 전달·열람 추적(수신 상태)이 되지 않습니다. 광고성 발송은 개인 계정을 쓰지 않습니다.
      </p>
    </div>
  );
}
