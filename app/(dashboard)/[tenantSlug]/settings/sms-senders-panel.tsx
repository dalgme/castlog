"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { formatKrMobile } from "@/lib/auth/phone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { addSmsSender, removeSmsSender } from "./actions";

export type SmsSenderRow = { id: string; phone: string; label: string | null };

/**
 * 발신번호 다중 등록 (기획 확정 2026-08-22).
 * 발송 화면에서 발신번호를 고를 수 있고, 기본값은 "보내는 직원 본인의
 * 휴대폰과 일치하는 등록 번호"다. 대표번호는 SMS 발송 설정의 값을 쓴다.
 */
export function SmsSendersPanel({
  defaultSender,
  senders,
}: {
  defaultSender: string | null;
  senders: SmsSenderRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");

  function add() {
    setError(null);
    startTransition(async () => {
      const r = await addSmsSender(phone, label);
      if (!r.ok) setError(r.error);
      else {
        setPhone("");
        setLabel("");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeSmsSender(id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        발송할 때 고를 수 있는 발신번호 목록입니다. <b>기본값은 항상 회사
        대표번호</b>이고, <b>휴대폰(01x)으로 등록된 번호는 그 번호의 본인
        (휴대폰이 일치하는 임직원)에게만 보여</b> 본인만 선택해 쓸 수 있습니다.
        유선·대표급 번호는 전 직원에게 보입니다. 여기 등록해도{" "}
        <b>공급자(솔라피) 계정에 사전등록되지 않은 번호는 발송이 거부됩니다.</b>
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ul className="space-y-1.5">
        {defaultSender && (
          <li className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
            <span className="font-medium">{formatKrMobile(defaultSender)}</span>
            <Badge variant="secondary" className="text-[10px]">
              대표번호
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              SMS 발송 설정에서 변경
            </span>
          </li>
        )}
        {senders.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md border p-2.5 text-sm"
          >
            <span className="font-medium">{formatKrMobile(s.phone)}</span>
            {s.label && (
              <span className="text-xs text-muted-foreground">{s.label}</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={pending}
              onClick={() => remove(s.id)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
          placeholder="발신번호 (예: 010-1234-5678)"
          className="h-9 max-w-[190px]"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="표시명 (예: 김예나 선임)"
          className="h-9 max-w-[170px]"
        />
        <Button size="sm" onClick={add} disabled={pending || !phone.trim()}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          추가
        </Button>
      </div>
    </div>
  );
}
