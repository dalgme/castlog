"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { setStaffActive } from "./actions";

/** 직원 활성/비활성 토글 — 비활성 시 즉시 로그인 차단 */
export function StaffActiveToggle({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">본인</span>;
  }

  function onToggle() {
    startTransition(async () => {
      const result = await setStaffActive(userId, !isActive);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={isActive ? "ghost" : "outline"}
      className={isActive ? "text-destructive hover:text-destructive" : ""}
      disabled={pending}
      onClick={onToggle}
    >
      {pending ? "처리 중..." : isActive ? "비활성화" : "활성화"}
    </Button>
  );
}
