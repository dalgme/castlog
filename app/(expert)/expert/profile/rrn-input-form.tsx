"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck, Lock, KeyRound } from "lucide-react";

import { encryptRrnEnvelope, createTenantKeyMaterial } from "@/lib/crypto/rrn-envelope";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  submitRrnEnvelope,
  setupExpertRrnKey,
  type RrnCollectionContext,
} from "./rrn-actions";

/**
 * 전문가 주민등록번호 등록 — 기업과 무관한 전문가 소유 데이터(재래핑 설계 §2.1).
 * 전문가 본인 키페어로 봉투 암호화한다. 개인키는 '보관 비밀번호'로 래핑되어
 * 플랫폼은 풀 수단이 없다(마스터키 없음). 평문은 이 브라우저에서만 존재한다.
 */
export function RrnInputForm({ context }: { context: RrnCollectionContext }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rrn, setRrn] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphrase2, setPassphrase2] = useState("");

  const ready = context.storeReady;
  const needsKey = !context.hasKey;

  const onSubmit = () => {
    setError(null);
    setDone(false);
    if (rrn.replace(/\D/g, "").length !== 13) {
      setError("주민등록번호 13자리를 정확히 입력하세요.");
      return;
    }
    if (needsKey) {
      if (passphrase.length < 8) {
        setError("보관 비밀번호는 8자 이상으로 설정하세요.");
        return;
      }
      if (passphrase !== passphrase2) {
        setError("보관 비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    } else if (!context.expertPublicKey) {
      setError("보안 키 정보를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
      return;
    }

    startTransition(async () => {
      try {
        let publicKey = context.expertPublicKey as JsonWebKey | null;

        // 최초 등록: 브라우저에서 키페어 생성 → 개인키를 보관 비밀번호로 래핑해 저장
        if (needsKey) {
          const material = await createTenantKeyMaterial(passphrase);
          const setup = await setupExpertRrnKey({
            publicKeyJwk: material.publicKeyJwk,
            wrappedPrivateKey: material.wrappedPrivateKey,
            kdfSalt: material.kdfSalt,
            kdfParams: material.kdfParams,
            wrapIv: material.wrapIv,
            alg: material.alg,
          });
          if (!setup.ok) {
            setError(setup.error);
            return;
          }
          publicKey = setup.publicKey as JsonWebKey;
        }

        if (!publicKey) {
          setError("보안 키가 준비되지 않았습니다.");
          return;
        }

        const envelope = await encryptRrnEnvelope(rrn, publicKey);
        const result = await submitRrnEnvelope({
          frontCiphertext: envelope.frontCiphertext,
          backCiphertext: envelope.backCiphertext,
          wrappedDek: envelope.wrappedDek,
        });
        if (!result.ok) setError(result.error);
        else {
          setDone(true);
          setRrn("");
          setPassphrase("");
          setPassphrase2("");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "브라우저 암호화에 실패했습니다.");
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
          보안 저장소 연결 설정(관리자: RRN_STORE_B_SERVICE_KEY)이 완료되면 등록이
          활성화됩니다.
        </p>
      )}

      {ready && needsKey && (
        <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/[0.04] p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
            <KeyRound className="h-4 w-4 text-brand" aria-hidden /> 보관 비밀번호 설정
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            내 주민번호를 잠그는 <b>나만의 비밀번호</b>입니다. 나중에 기업 섭외를
            <b> 수락할 때</b> 지급명세서용 키를 안전하게 전달하기 위해 다시 입력합니다.
            서버에 저장되지 않으며, <b>분실 시 복구가 불가능</b>해 주민번호를 다시
            등록해야 합니다.
          </p>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="보관 비밀번호 (8자 이상)"
            autoComplete="new-password"
            disabled={!ready}
          />
          <Input
            type="password"
            value={passphrase2}
            onChange={(e) => setPassphrase2(e.target.value)}
            placeholder="보관 비밀번호 확인"
            autoComplete="new-password"
            disabled={!ready}
          />
        </div>
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
      {/* 등록된 뒤에는 '수정하기'로 — 등록 완료 상태가 한눈에 보이게 (기획 확정 2026-08-22) */}
      <Button
        onClick={onSubmit}
        disabled={pending || !ready}
        className={
          context.alreadyOnFile || done
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : undefined
        }
      >
        {pending
          ? "암호화·등록 중..."
          : context.alreadyOnFile || done
            ? "수정하기"
            : needsKey
              ? "보관 비밀번호 설정 + 등록"
              : "암호화하여 등록"}
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
