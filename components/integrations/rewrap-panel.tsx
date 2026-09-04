"use client";

import { useState, useTransition } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rewrapDekToTenant } from "@/lib/crypto/rrn-envelope";
import type { RewrapContext, RewrapSubmitResult } from "@/lib/integrations/rrn-rewrap";

/**
 * 지급용 주민번호 키 전달 패널 — 공개 링크(/e)와 전문가 포털이 함께 쓴다.
 * 재래핑은 이 브라우저에서 끝나고, 서버에는 결과(기업 키로 봉인된 DEK)만 간다.
 */
export function RewrapPanel({
  ctx,
  onSubmit,
}: {
  ctx: Extract<RewrapContext, { applicable: true }>;
  onSubmit: (input: { frontId: string; newWrappedDek: string }) => Promise<RewrapSubmitResult>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = () => {
    setError(null);
    if (!passphrase) {
      setError("보관 비밀번호를 입력하세요.");
      return;
    }
    startTransition(async () => {
      try {
        const newWrappedDek = await rewrapDekToTenant({
          wrappedPrivateKey: ctx.keyMaterial.wrappedPrivateKey,
          kdfSalt: ctx.keyMaterial.kdfSalt,
          wrapIv: ctx.keyMaterial.wrapIv,
          passphrase,
          wrappedDek: ctx.wrappedDek,
          tenantPublicKeyJwk: ctx.tenantPublicKey as JsonWebKey,
        });
        const result = await onSubmit({ frontId: ctx.frontId, newWrappedDek });
        if (!result.ok) setError(result.error);
        else {
          setOk(true);
          setPassphrase("");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "처리에 실패했습니다.");
      }
    });
  };

  if (ok) {
    return (
      <Alert>
        <AlertDescription className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
          지급명세서용 주민번호 키를 이 기업에 안전하게 전달했습니다. 평문은 어디에도
          저장되지 않았으며, 열람 시 알림을 받으실 수 있습니다.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
        <KeyRound className="h-4 w-4 text-brand" aria-hidden /> 지급을 위한 주민번호 키 전달
        (선택)
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        이 기업이 지급명세서 작성 시 <b>필요 시점에만</b> 주민번호를 열람할 수 있도록,
        <b> 보관 비밀번호</b>로 키를 이 기업 전용으로 다시 봉인해 전달합니다. 비밀번호와
        평문은 서버로 전송되지 않으며, 이 브라우저에서만 처리됩니다.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="보관 비밀번호"
        autoComplete="off"
        aria-label="보관 비밀번호"
      />
      <Button size="sm" className="h-10" onClick={run} disabled={pending}>
        {pending ? "전달 중..." : "키 전달"}
      </Button>
    </div>
  );
}
