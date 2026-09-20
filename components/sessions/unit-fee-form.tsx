"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commaInputHandler, formatComma } from "@/components/ui/comma-number-input";
import { useToast } from "@/hooks/use-toast";
import type { DeliveryMode } from "@/lib/sessions/schedule";

import { applySlotUnitFees } from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/slot-actions";

/** 진행 방식별로 어떤 단가 칸이 필요한가 */
export function unitFeeFields(mode: DeliveryMode | null): { key: "online" | "offline"; label: string }[] {
  if (mode === "online") return [{ key: "online", label: "온라인 회당 단가" }];
  if (mode === "hybrid")
    return [
      { key: "online", label: "온라인 회당 단가" },
      { key: "offline", label: "오프라인 회당 단가" },
    ];
  if (mode === "offline") return [{ key: "offline", label: "오프라인 회당 단가" }];
  return [{ key: "offline", label: "회당 단가" }];
}

/**
 * 세션 회당 단가 일괄 등록 (기획 지시 2026-09-21) — 섭외후보 등록의 세션 제목 옆.
 * 진행 방식에 따라 온라인/오프라인/둘 다 칸이 보이고, '일괄등록'을 누르면 개별 수정하지
 * 않은 후보 전원에게 적용된다. 이후 후보별로 고치면 그 후보만 코랄로 표시된다.
 */
export function UnitFeeBulkForm({
  slotId,
  deliveryMode,
  online,
  offline,
  editable,
}: {
  slotId: string;
  deliveryMode: DeliveryMode | null;
  online: number | null;
  offline: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ online: formatComma(online), offline: formatComma(offline) });
  const fields = unitFeeFields(deliveryMode);

  function apply() {
    startTransition(async () => {
      const r = await applySlotUnitFees(slotId, {
        online: draft.online.replace(/\D/g, ""),
        offline: draft.offline.replace(/\D/g, ""),
      });
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        toast({ description: "회당 단가를 후보 전원에게 일괄 등록했습니다 (개별 수정한 후보는 제외)." });
        router.refresh();
      }
    });
  }

  if (!editable) {
    const parts = fields
      .map((f) => {
        const v = f.key === "online" ? online : offline;
        return v === null ? null : `${f.label} ${v.toLocaleString("ko-KR")}원`;
      })
      .filter(Boolean);
    return parts.length ? <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span> : null;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs">
      <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {fields.map((f) => (
        <label key={f.key} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">{f.label}</span>
          <Input
            inputMode="numeric"
            value={draft[f.key]}
            onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
            onInput={commaInputHandler}
            placeholder="000,000"
            className="h-7 w-28 text-xs tabular-nums"
            aria-label={f.label}
          />
          원
        </label>
      ))}
      <Button type="button" size="sm" className="h-7 text-xs" disabled={pending} onClick={apply}>
        일괄등록
      </Button>
    </span>
  );
}
