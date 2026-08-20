"use client";

import { useState, useTransition } from "react";
import { Check, MailPlus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { resendOrgAdminInvite } from "./actions";

/**
 * 비밀번호 설정 메일 다시 보내기.
 *
 * 결과를 버튼 옆에 그대로 남긴다 — 눌렀는데 아무 표시가 없으면 운영자는
 * 갔는지 안 갔는지 모른 채 한 번 더 누르고, 그러면 대표에게 같은 메일이
 * 두 통 간다.
 */
export function ResendInviteButton({
  tenantId,
  disabled,
}: {
  tenantId: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sent"; email: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function run() {
    setState({ kind: "idle" });
    startTransition(async () => {
      const res = await resendOrgAdminInvite(tenantId);
      setState(
        res.ok
          ? { kind: "sent", email: res.email }
          : { kind: "error", message: res.error }
      );
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={run}
        disabled={pending || disabled}
        title="대표에게 비밀번호 설정 링크를 메일로 다시 보냅니다"
      >
        <MailPlus className="mr-1.5 h-3.5 w-3.5" />
        {pending ? "보내는 중…" : "비밀번호 설정 메일"}
      </Button>
      {state.kind === "sent" && (
        <span className="inline-flex items-center gap-1 text-xs text-green-700">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {state.email} 로 보냈습니다
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-xs text-destructive">{state.message}</span>
      )}
    </span>
  );
}
