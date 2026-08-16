"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";

import { createTenantKeyMaterial } from "@/lib/crypto/rrn-envelope";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveTenantRrnKey } from "./rrn-key-actions";

/**
 * 테넌트 RRN 조회 비밀번호 설정 (기업총괄관리자).
 * 조회 비밀번호로 개인키를 브라우저에서 래핑해 저장한다. 비밀번호 자체는 서버로
 * 전송되지 않으며 어디에도 저장되지 않는다(분실 시 재설정 = 새 키페어).
 */
export function RrnKeySetupPanel({ alreadySet }: { alreadySet: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const onSubmit = () => {
    setError(null);
    setDone(false);
    if (pw.length < 10) {
      setError("조회 비밀번호는 10자 이상으로 설정하세요.");
      return;
    }
    if (pw !== pw2) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    startTransition(async () => {
      try {
        const material = await createTenantKeyMaterial(pw);
        const result = await saveTenantRrnKey(material);
        if (!result.ok) setError(result.error);
        else {
          setDone(true);
          setPw("");
          setPw2("");
        }
      } catch {
        setError("브라우저 암호화에 실패했습니다. 최신 브라우저에서 다시 시도하세요.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-brand/40 bg-[#F2F6FF] p-3 text-sm text-[#33405A]">
        <KeyRound className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
        <p>
          주민등록번호를 지급명세서 목적으로 열람할 때 사용하는 <b>조회 비밀번호</b>를
          설정합니다. 이 비밀번호로 열람 키가 잠기며, <b>서버에 저장되지 않습니다.</b>{" "}
          분실 시 재설정하면 새 키로 교체되고 기존 암호문은 열람할 수 없게 되니, 지정된
          담당자(회계담당·대표)만 안전하게 공유·보관하세요.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {done && (
        <Alert>
          <AlertDescription>조회 비밀번호(열람 키)가 설정되었습니다.</AlertDescription>
        </Alert>
      )}
      {alreadySet && !done && (
        <p className="text-sm text-muted-foreground">
          현재 열람 키가 설정되어 있습니다. 아래에서 재설정할 수 있습니다(재설정 시 기존
          암호문은 열람 불가).
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="조회 비밀번호 (10자 이상)"
          autoComplete="new-password"
        />
        <Input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="비밀번호 확인"
          autoComplete="new-password"
        />
      </div>
      <Button onClick={onSubmit} disabled={pending || !pw || !pw2}>
        {pending ? "설정 중..." : alreadySet ? "열람 키 재설정" : "열람 키 설정"}
      </Button>
    </div>
  );
}
