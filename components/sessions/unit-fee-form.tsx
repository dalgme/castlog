"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commaInputHandler, formatComma } from "@/components/ui/comma-number-input";
import { useToast } from "@/hooks/use-toast";
import { fmtHours, type DeliveryMode } from "@/lib/sessions/schedule";
import { formatWon, unitFromHourly } from "@/lib/sessions/fees";

import { applySlotUnitFees } from "@/app/(dashboard)/[tenantSlug]/projects/[projectId]/slot-actions";

/** 진행 방식별로 어떤 금액 칸이 필요한가 (라벨은 시간당 비용 기준 — 기획 지시 2026-09-21) */
export function unitFeeFields(mode: DeliveryMode | null): { key: "online" | "offline"; label: string }[] {
  if (mode === "online") return [{ key: "online", label: "온라인 시간당 비용" }];
  if (mode === "hybrid")
    return [
      { key: "online", label: "온라인 시간당 비용" },
      { key: "offline", label: "오프라인 시간당 비용" },
    ];
  if (mode === "offline") return [{ key: "offline", label: "오프라인 시간당 비용" }];
  return [{ key: "offline", label: "시간당 비용" }];
}

/** 저장된 시간당 비용이 없고 회당 단가만 있으면(구 데이터) 시간당으로 역산해 보여 준다 */
export function hourlyFromStored(hourly: number | null, unit: number | null, hours: number | null): number | null {
  if (hourly !== null) return hourly;
  if (unit === null) return null;
  return Math.round(unit / (hours ?? 1));
}

/**
 * 세션 시간당 비용 일괄 등록 (기획 지시 2026-09-21) — 섭외후보 등록의 세션 제목 아래.
 * 진행 방식에 따라 온라인/오프라인/둘 다 칸이 보이고, 회당 단가 = 시간당 비용 × 회차당 시간이
 * 옆에 계산돼 보인다. '일괄등록'을 누르면 개별 수정하지 않은 후보 전원에게 적용된다.
 */
export function UnitFeeBulkForm({
  slotId,
  deliveryMode,
  hours,
  online,
  offline,
  hourlyOnline,
  hourlyOffline,
  editable,
}: {
  slotId: string;
  deliveryMode: DeliveryMode | null;
  /** 회차당 시간 — 세션에서 입력. 없으면 1시간으로 계산하고 그 사실을 알린다 */
  hours: number | null;
  /** 저장된 회당 단가 (계산 결과) */
  online: number | null;
  offline: number | null;
  /** 저장된 시간당 비용 (입력값) */
  hourlyOnline: number | null;
  hourlyOffline: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    online: formatComma(hourlyFromStored(hourlyOnline, online, hours)),
    offline: formatComma(hourlyFromStored(hourlyOffline, offline, hours)),
  });
  const fields = unitFeeFields(deliveryMode);
  const hoursText = hours ? `${fmtHours(hours)}시간` : "1시간(미입력)";

  function apply() {
    startTransition(async () => {
      const r = await applySlotUnitFees(slotId, {
        hourlyOnline: draft.online.replace(/\D/g, ""),
        hourlyOffline: draft.offline.replace(/\D/g, ""),
      });
      if (!r.ok) toast({ variant: "destructive", description: r.error });
      else {
        toast({ description: "시간당 비용을 후보 전원에게 일괄 등록했습니다 (개별 수정한 후보는 제외)." });
        router.refresh();
      }
    });
  }

  const derived = (key: "online" | "offline") => {
    const raw = draft[key].replace(/\D/g, "");
    const hourly = raw ? parseInt(raw, 10) : null;
    const unit = unitFromHourly(hourly, hours);
    return unit === null ? null : formatWon(unit);
  };

  if (!editable) {
    const parts = fields
      .map((f) => {
        const unit = f.key === "online" ? online : offline;
        const hourly = hourlyFromStored(f.key === "online" ? hourlyOnline : hourlyOffline, unit, hours);
        if (unit === null && hourly === null) return null;
        return `${f.label.replace(" 시간당 비용", "").replace("시간당 비용", "").trim() || "단가"}${
          hourly !== null ? ` 시간당 ${formatWon(hourly)}` : ""
        }${unit !== null ? ` → 회당 ${formatWon(unit)}` : ""}`;
      })
      .filter(Boolean);
    return parts.length ? (
      <span className="text-xs text-muted-foreground">
        {parts.join(" · ")} (회차당 {hoursText})
      </span>
    ) : null;
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
          <span className="text-muted-foreground" title={`시간당 비용 × 회차당 ${hoursText}`}>
            {derived(f.key) ? `→ 회당 ${derived(f.key)}` : ""}
          </span>
        </label>
      ))}
      <span className={hours ? "text-muted-foreground" : "font-semibold text-amber-700"} title="세션 수정 팝업의 '회차당 시간'">
        회차당 {hoursText}
      </span>
      <Button type="button" size="sm" className="h-7 text-xs" disabled={pending} onClick={apply}>
        일괄등록
      </Button>
    </span>
  );
}
