"use client";

import { useEffect, useState, useTransition } from "react";
import { ShieldAlert, Eye, Timer } from "lucide-react";

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
import { decryptRrnEnvelope } from "@/lib/crypto/rrn-envelope";
import { RRN_ACCESS_REASONS, type RrnAccessReason } from "@/lib/integrations/rrn-access";

import {
  listRevealTargets,
  getRevealMaterial,
  type RevealTarget,
} from "./tax-reveal-actions";

const AUTO_CLEAR_SECONDS = 20;

/**
 * 주민등록번호 조회(회계담당·대표) — 브라우저 복호화(§2.3).
 * 조회 비밀번호로 복호화하며 서버는 평문을 보지 않는다. 워터마크 + 자동 재마스킹.
 */
export function RrnRevealPanel({ accessorHint }: { accessorHint: string }) {
  const [targets, setTargets] = useState<RevealTarget[] | null>(null);
  const [notAllowed, setNotAllowed] = useState<string | null>(null);

  const [grantId, setGrantId] = useState("");
  const [reason, setReason] = useState<RrnAccessReason | "">("");
  const [password, setPassword] = useState("");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let alive = true;
    listRevealTargets().then((r) => {
      if (!alive) return;
      if (r.ok) setTargets(r.targets);
      else setNotAllowed(r.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 자동 재마스킹 카운트다운
  useEffect(() => {
    if (revealed == null) return;
    if (countdown <= 0) {
      setRevealed(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [revealed, countdown]);

  const onReveal = () => {
    setError(null);
    setRevealed(null);
    if (!grantId) return setError("전문가를 선택하세요.");
    if (!reason) return setError("조회 사유를 선택하세요.");
    if (!password) return setError("조회 비밀번호를 입력하세요.");
    startTransition(async () => {
      const res = await getRevealMaterial(grantId, reason);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      try {
        const rrn = await decryptRrnEnvelope({
          wrappedPrivateKey: res.material.wrappedPrivateKey,
          kdfSalt: res.material.kdfSalt,
          wrapIv: res.material.wrapIv,
          lookupPassword: password,
          wrappedDekForTenant: res.material.wrappedDekForTenant,
          frontCiphertext: res.material.frontCiphertext,
          backCiphertext: res.material.backCiphertext,
        });
        setPassword("");
        setRevealed(rrn);
        setCountdown(AUTO_CLEAR_SECONDS);
      } catch (e) {
        setError(e instanceof Error ? e.message : "복호화에 실패했습니다.");
      }
    });
  };

  if (notAllowed) {
    return (
      <Alert>
        <AlertDescription className="flex items-start gap-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
          {notAllowed} 지정은 위 &lsquo;주민번호 조회 지정자&rsquo;에서 관리합니다.
        </AlertDescription>
      </Alert>
    );
  }

  const fmtRrn = (r: string) => (r.length === 13 ? `${r.slice(0, 6)}-${r.slice(6)}` : r);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        조회는 <b>지정자(회계담당·대표)</b>만 가능하며, 매 조회는 기록되어 전문가에게
        즉시 통지됩니다. 프로젝트당 2회·시간당 상한이 적용되고, 화면은 {AUTO_CLEAR_SECONDS}초
        후 자동으로 가려집니다. 복호화는 이 브라우저에서만 일어나며 서버는 평문을 보지
        않습니다.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select value={grantId} onValueChange={setGrantId}>
          <SelectTrigger>
            <SelectValue placeholder="전문가 선택" />
          </SelectTrigger>
          <SelectContent>
            {(targets ?? []).map((t) => (
              <SelectItem key={t.grantId} value={t.grantId}>
                {t.expertName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={reason} onValueChange={(v) => setReason(v as RrnAccessReason)}>
          <SelectTrigger>
            <SelectValue placeholder="조회 사유" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RRN_ACCESS_REASONS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {targets && targets.length === 0 && (
        <p className="rounded-md bg-secondary/50 p-2 text-xs text-muted-foreground">
          아직 조회할 수 있는 전문가가 없습니다. 섭외 수락 시 전문가가 지급용 키를
          전달하면 여기에 표시됩니다.
        </p>
      )}

      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="조회 비밀번호"
        autoComplete="off"
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {revealed && (
        <div className="relative overflow-hidden rounded-lg border-2 border-brand/40 bg-white p-4 text-center">
          <div
            className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-[11px] font-bold uppercase tracking-widest text-brand/10"
            aria-hidden
          >
            {accessorHint} · {new Date().toLocaleString("ko-KR")}
          </div>
          <p className="relative text-2xl font-bold tracking-widest text-brand-navy">
            {fmtRrn(revealed)}
          </p>
          <p className="relative mt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Timer className="h-3 w-3" /> {countdown}초 후 자동으로 가려집니다
          </p>
        </div>
      )}

      <Button onClick={onReveal} disabled={pending || !targets}>
        <Eye className="mr-1.5 h-4 w-4" aria-hidden />
        {pending ? "조회 중..." : "주민등록번호 조회"}
      </Button>
    </div>
  );
}
