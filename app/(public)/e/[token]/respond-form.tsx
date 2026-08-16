"use client";

import { useState, useTransition } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rewrapDekToTenant } from "@/lib/crypto/rrn-envelope";

import {
  respondToEngagementByToken,
  getRewrapContext,
  submitRewrap,
  type RewrapContext,
} from "./actions";

/** 섭외 수락·거절 폼 — 모바일 완전 대응 (공개 링크). 수락 시 주민번호 키 재래핑 안내. */
export function EngagementRespondForm({ token }: { token: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [rewrap, setRewrap] = useState<RewrapContext | null>(null);

  function onRespond(decision: "accepted" | "declined") {
    if (
      decision === "accepted" &&
      !window.confirm("섭외를 수락하시겠습니까? 수락 시 계약이 성립합니다.")
    ) {
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await respondToEngagementByToken(token, {
        decision,
        responseNote: note || undefined,
      });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setDone(result.decision);
      if (result.decision === "accepted") {
        const ctx = await getRewrapContext(token);
        setRewrap(ctx);
      }
    });
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertDescription>
            {done === "accepted"
              ? "섭외를 수락했습니다. 계약이 성립되었으며 기업 담당자에게 전달됩니다."
              : "섭외를 거절했습니다. 기업 담당자에게 전달됩니다."}
          </AlertDescription>
        </Alert>
        {done === "accepted" && rewrap?.applicable && (
          <RewrapPanel token={token} ctx={rewrap} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <Textarea
        rows={2}
        placeholder="의견 (선택)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("accepted")}
        >
          {pending ? "처리 중..." : "수락"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => onRespond("declined")}
        >
          거절
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        수락 시 계약이 성립하며, 응답 내역은 기업과 전문가 포털에 기록됩니다.
      </p>
    </div>
  );
}

function RewrapPanel({
  token,
  ctx,
}: {
  token: string;
  ctx: Extract<RewrapContext, { applicable: true }>;
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
        const result = await submitRewrap(token, {
          frontId: ctx.frontId,
          newWrappedDek,
        });
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
      />
      <Button size="sm" onClick={run} disabled={pending}>
        {pending ? "전달 중..." : "키 전달"}
      </Button>
    </div>
  );
}
