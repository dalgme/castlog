"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck, Lock } from "lucide-react";

import { encryptRrnEnvelope } from "@/lib/crypto/rrn-envelope";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  submitRrnEnvelope,
  type RrnCollectionContext,
} from "./rrn-actions";

/**
 * 전문가 주민등록번호 등록 — 기업과 무관한 전문가 소유 데이터.
 * 평문은 이 화면(브라우저)에서만 존재하고, 서버로는 봉투 암호문만 전송된다
 * (플랫폼 서비스 공개키로 DEK 래핑, 앞/뒤 분할, 앞조각=메인·뒷조각=저장소 B).
 */
export function RrnInputForm({ context }: { context: RrnCollectionContext }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rrn, setRrn] = useState("");

  const ready = context.storeReady && context.serviceReady;

  const onSubmit = () => {
    setError(null);
    setDone(false);
    if (!context.servicePublicKey) {
      setError("보안 설정이 준비되지 않았습니다.");
      return;
    }
    if (rrn.replace(/\D/g, "").length !== 13) {
      setError("주민등록번호 13자리를 정확히 입력하세요.");
      return;
    }
    startTransition(async () => {
      try {
        const envelope = await encryptRrnEnvelope(
          rrn,
          context.servicePublicKey as JsonWebKey
        );
        const result = await submitRrnEnvelope({
          frontCiphertext: envelope.frontCiphertext,
          backCiphertext: envelope.backCiphertext,
          wrappedDek: envelope.wrappedDek,
        });
        if (!result.ok) setError(result.error);
        else {
          setDone(true);
          setRrn("");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "브라우저 암호화에 실패했습니다."
        );
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm leading-relaxed text-[#33405A]">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
        <p>
          주민등록번호는 미리 등록해 두면, 이후 계약된 기업이 지급명세서 목적으로만
          열람합니다. 입력값은 <b>이 화면(브라우저)에서 즉시 암호화·분할</b>되어
          전송되며, 서버·플랫폼 운영사는 평문을 볼 수 없습니다. 열람 시 전문가님께
          즉시 알림이 갑니다.
        </p>
      </div>

      {context.alreadyOnFile && !done && (
        <Alert>
          <AlertDescription>
            이미 등록된 주민등록번호가 있습니다. 다시 등록하면 새 값으로 추가됩니다.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {done && (
        <Alert>
          <AlertDescription>
            주민등록번호가 안전하게 암호화되어 등록되었습니다.
          </AlertDescription>
        </Alert>
      )}

      {!ready && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-[#FFF3D6] p-3 text-sm text-[#8A6A00]">
          <Lock className="h-4 w-4 flex-none" aria-hidden />
          {!context.serviceReady
            ? "플랫폼 보안 키 설정이 준비되면 등록이 활성화됩니다."
            : "보안 저장소 연결 설정(관리자: RRN_STORE_B_SERVICE_KEY)이 완료되면 등록이 활성화됩니다."}
        </p>
      )}

      <Input
        inputMode="numeric"
        value={rrn}
        onChange={(e) => setRrn(e.target.value)}
        placeholder="주민등록번호 13자리"
        maxLength={14}
        autoComplete="off"
        disabled={!ready}
      />
      <Button onClick={onSubmit} disabled={pending || !ready}>
        {pending ? "암호화·등록 중..." : "암호화하여 등록"}
      </Button>

      <p className="pt-1 text-xs text-muted-foreground">
        열람 이력은{" "}
        <Link href="/expert/tax-access" className="text-brand underline">
          주민등록번호 조회 이력
        </Link>
        에서 언제든 확인할 수 있습니다.
      </p>
    </div>
  );
}
