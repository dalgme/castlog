"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { setTenantMonitoring, type MonitorHours } from "./actions";

/** 모니터링 창 켜기(길이 선택)/끄기 — 목록 행 안의 조작부 */
export function MonitorToggle({
  tenantId,
  active,
}: {
  tenantId: string;
  active: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  function apply(hours: MonitorHours | null) {
    startTransition(async () => {
      const result = await setTenantMonitoring(tenantId, hours);
      if (!result.ok) {
        toast({ variant: "destructive", description: result.error });
        return;
      }
      setPickerOpen(false);
      router.refresh();
    });
  }

  if (active) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => apply(null)}
      >
        {pending ? "처리 중..." : "끄기"}
      </Button>
    );
  }

  if (!pickerOpen) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => setPickerOpen(true)}
      >
        켜기
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {([4, 12, 24] as MonitorHours[]).map((h) => (
        <Button
          key={h}
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => apply(h)}
        >
          {h}시간
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setPickerOpen(false)}
      >
        취소
      </Button>
    </span>
  );
}
