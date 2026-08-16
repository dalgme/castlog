"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck, Lock } from "lucide-react";

import { encryptRrnEnvelope } from "@/lib/crypto/rrn-envelope";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  submitRrnEnvelope,
  type RrnCollectionContext,
} from "./rrn-actions";

/**
 * 전문가 주민등록번호 등록 — 평문은 이 화면(브라우저)에서만 존재하고, 서버로는
 * 봉투 암호문만 전송된다(앞조각=메인, 뒷조각=저장소 B, DEK=기업 공개키로 래핑).
 */
export function RrnInputForm({ context }: { context: RrnCollectionContext }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [tenantId, setTenantId] = useState(context.tenants[0]?.tenantId ?? "");
  const [rrn, setRrn] = useState("");

  const disabled = !context.storeReady || context.tenants.length === 0;

  const onSubmit = () => {
    setError(null);
    setDone(false);
    const tenant = context.tenants.find((t) => t.tenantId === tenantId);
    if (!tenant) {
      setError("등록할 기업을 선택하세요.");
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
          tenant.publicKeyJwk as JsonWebKey
        );
        const result = await submitRrnEnvelope({
          tenantId: tenant.tenantId,
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
          주민등록번호는 소득세법상 지급명세서 목적으로만 사용됩니다. 입력값은{" "}
          <b>이 화면(브라우저)에서 즉시 암호화·분할</b>되어 전송되며, 서버·플랫폼
          운영사는 평문을 볼 수 없습니다. 열람 시 전문가님께 즉시 알림이 갑니다.
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

      {context.tenants.length === 0 ? (
        <p className="rounded-lg border bg-secondary/60 p-3 text-sm text-muted-foreground">
          소속 기업이 <b>열람 키(조회 비밀번호)</b>를 먼저 설정해야 등록할 수 있습니다.
          기업 담당자에게 설정을 요청해 주세요.
        </p>
      ) : (
        <>
          {!context.storeReady && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-[#FFF3D6] p-3 text-sm text-[#8A6A00]">
              <Lock className="h-4 w-4 flex-none" aria-hidden />
              보안 저장소 연결 설정이 완료되면 등록이 활성화됩니다.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select value={tenantId} onValueChange={setTenantId} disabled={disabled}>
              <SelectTrigger>
                <SelectValue placeholder="기업 선택" />
              </SelectTrigger>
              <SelectContent>
                {context.tenants.map((t) => (
                  <SelectItem key={t.tenantId} value={t.tenantId}>
                    {t.tenantName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              inputMode="numeric"
              value={rrn}
              onChange={(e) => setRrn(e.target.value)}
              placeholder="주민등록번호 13자리"
              maxLength={14}
              autoComplete="off"
              disabled={disabled}
            />
          </div>
          <Button onClick={onSubmit} disabled={pending || disabled}>
            {pending ? "암호화·등록 중..." : "암호화하여 등록"}
          </Button>
        </>
      )}

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
