"use client";

import { useEffect, useState, useTransition } from "react";
import { ShieldAlert, Eye, Timer, FileDown } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  requestOverLimitAccess,
  type RevealTarget,
  type RevealAccessType,
} from "./tax-reveal-actions";

const AUTO_CLEAR_SECONDS = 20;

/**
 * 주민등록번호 조회(회계담당·대표) — 브라우저 복호화(§2.3).
 * 기본 경로는 지급명세서 파일 생성(§5), 화면 조회는 예외. 재인증(계정 비밀번호) +
 * 조회 비밀번호(복호화). 서버는 평문을 보지 않는다.
 */
export function RrnRevealPanel({ accessorHint }: { accessorHint: string }) {
  const [targets, setTargets] = useState<RevealTarget[] | null>(null);
  const [notAllowed, setNotAllowed] = useState<string | null>(null);

  const [grantId, setGrantId] = useState("");
  const [reason, setReason] = useState<RrnAccessReason | "">("");
  const [accountPassword, setAccountPassword] = useState("");
  const [password, setPassword] = useState("");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  // 한도 초과 — 차단이 아니라 사유 기재 + 대표 승인으로 넘어가는 분기(§5)
  const [overLimit, setOverLimit] = useState<{ usedCount: number } | null>(null);
  const [overLimitReason, setOverLimitReason] = useState("");

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

  useEffect(() => {
    if (revealed == null) return;
    if (countdown <= 0) {
      setRevealed(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [revealed, countdown]);

  const csvDownload = (expertName: string, rrn: string, reasonKey: RrnAccessReason) => {
    const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const rows = [
      ["항목", "값"],
      ["전문가", expertName],
      ["주민등록번호", rrn.length === 13 ? `${rrn.slice(0, 6)}-${rrn.slice(6)}` : rrn],
      ["조회 사유", RRN_ACCESS_REASONS[reasonKey]],
      ["조회자", accessorHint],
      ["생성 일시", now],
    ];
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `지급명세서_${expertName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const submitOverLimit = () => {
    if (!grantId || !reason) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await requestOverLimitAccess(grantId, reason, overLimitReason);
      if (!r.ok) setError(r.error);
      else {
        setOverLimit(null);
        setOverLimitReason("");
        setInfo(
          "초과 조회 요청을 접수했습니다. 대표 승인 후 다시 조회하세요. 승인 1건은 조회 1회분입니다."
        );
      }
    });
  };

  const run = (accessType: RevealAccessType) => {
    setError(null);
    setInfo(null);
    setRevealed(null);
    setOverLimit(null);
    if (!grantId) return setError("전문가를 선택하세요.");
    if (!reason) return setError("조회 사유를 선택하세요.");
    if (!accountPassword) return setError("재인증: 계정 비밀번호를 입력하세요.");
    if (!password) return setError("조회 비밀번호를 입력하세요.");
    startTransition(async () => {
      const res = await getRevealMaterial(grantId, reason, accountPassword, accessType);
      if (!res.ok) {
        setError(res.error);
        if (res.needsOverLimitApproval) {
          setOverLimit({ usedCount: res.usedCount ?? 0 });
        }
        return;
      }
      setOverLimit(null);
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
        setAccountPassword("");
        if (accessType === "file_generation") {
          csvDownload(res.material.expertName, rrn, reason);
          setInfo("지급명세서 파일이 생성되었습니다. 평문은 화면·서버에 남지 않습니다.");
        } else {
          setRevealed(rrn);
          setCountdown(AUTO_CLEAR_SECONDS);
        }
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
        지정자(회계담당·대표)만 가능하며, 매 조회는 기록되어 전문가에게 즉시 통지됩니다.
        프로젝트당 2회·시간당 상한이 적용됩니다. <b>기본은 지급명세서 파일 생성</b>이며,
        화면 조회는 예외로 {AUTO_CLEAR_SECONDS}초 후 자동으로 가려집니다. 복호화는 이
        브라우저에서만 일어나며 서버는 평문을 보지 않습니다.
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          type="password"
          value={accountPassword}
          onChange={(e) => setAccountPassword(e.target.value)}
          placeholder="재인증: 계정 비밀번호"
          autoComplete="off"
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="조회 비밀번호"
          autoComplete="off"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      {overLimit && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            이 프로젝트에서 이미 {overLimit.usedCount}회 조회했습니다. 초과 조회는
            막지 않지만 <b>사유를 남기고 대표 승인</b>을 받아야 하며, 조회 시 전문가
            본인에게 초과 사실이 통지됩니다.
          </p>
          <Textarea
            rows={2}
            value={overLimitReason}
            onChange={(e) => setOverLimitReason(e.target.value)}
            placeholder="초과 조회 사유 (예: 국세청 경정청구 대응으로 지급명세서 재작성 필요)"
          />
          <Button size="sm" onClick={submitOverLimit} disabled={pending}>
            대표 승인 요청
          </Button>
        </div>
      )}

      {revealed && (
        <div className="relative overflow-hidden rounded-lg border-2 border-brand/40 bg-white p-4 text-center">
          <div
            className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-[11px] font-bold uppercase tracking-widest text-brand/10"
            aria-hidden
          >
            {accessorHint} · {new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          </div>
          <p className="relative text-2xl font-bold tracking-widest text-brand-navy">
            {fmtRrn(revealed)}
          </p>
          <p className="relative mt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Timer className="h-3 w-3" /> {countdown}초 후 자동으로 가려집니다
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run("file_generation")} disabled={pending || !targets}>
          <FileDown className="mr-1.5 h-4 w-4" aria-hidden />
          {pending ? "처리 중..." : "지급명세서 파일 생성"}
        </Button>
        <Button
          variant="outline"
          onClick={() => run("screen")}
          disabled={pending || !targets}
        >
          <Eye className="mr-1.5 h-4 w-4" aria-hidden />
          화면 조회(예외)
        </Button>
      </div>
    </div>
  );
}
