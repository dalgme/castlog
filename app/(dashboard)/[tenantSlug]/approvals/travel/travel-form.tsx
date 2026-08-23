"use client";

import { useMemo, useState, useTransition } from "react";
import { Calculator } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CommaNumberInput } from "@/components/ui/comma-number-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { estimateTravel, submitTravelRequest } from "./actions";

type FuelOption = { value: string; label: string };

/** 단계 22: 출장품의 폼 — 자동 계산(있으면) + 수동 입력 폴백. */
export function TravelForm({
  fuelTypes,
  defaultEfficiency,
  integration,
}: {
  fuelTypes: FuelOption[];
  defaultEfficiency: Record<string, number>;
  integration: { fuelPrice: boolean; distance: boolean };
}) {
  const [purpose, setPurpose] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [roundTrip, setRoundTrip] = useState(true);
  const [fuelType, setFuelType] = useState("gasoline");
  const [distanceKm, setDistanceKm] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [efficiency, setEfficiency] = useState(
    String(defaultEfficiency.gasoline ?? 12)
  );
  const [tollCost, setTollCost] = useState("");
  const [otherCost, setOtherCost] = useState("");
  const [note, setNote] = useState("");
  const [autoSource, setAutoSource] = useState<string | null>(null);
  // 자동 계산 실패 사유 — 화면에 남겨 두어야 연결 문제를 고칠 수 있다
  const [autoIssues, setAutoIssues] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const fuelCost = useMemo(() => {
    const eff = num(efficiency);
    if (eff <= 0) return 0;
    const dist = num(distanceKm) * (roundTrip ? 2 : 1);
    return Math.round((dist / eff) * num(fuelPrice));
  }, [distanceKm, roundTrip, efficiency, fuelPrice]);
  const total = fuelCost + num(tollCost) + num(otherCost);

  function onFuelTypeChange(v: string) {
    setFuelType(v);
    if (defaultEfficiency[v]) setEfficiency(String(defaultEfficiency[v]));
  }

  function onAutoCalc() {
    startTransition(async () => {
      const res = await estimateTravel({ origin, destination, fuelType });
      if (!res.ok) {
        toast({ variant: "destructive", description: res.error });
        return;
      }
      const filled: string[] = [];
      if (res.distanceKm !== null) {
        setDistanceKm(String(res.distanceKm));
        filled.push("거리");
      }
      if (res.fuelPrice !== null) {
        setFuelPrice(String(res.fuelPrice));
        filled.push("유가");
      }
      setAutoSource(res.source);
      setAutoIssues(res.issues);
      toast({
        variant: filled.length > 0 ? "default" : "destructive",
        description:
          filled.length > 0
            ? `${filled.join("·")} 자동 입력됨. 나머지는 직접 확인하세요.`
            : (res.issues[0] ?? "자동 계산이 되지 않아 수동 입력이 필요합니다."),
      });
    });
  }

  function onSubmit() {
    if (!purpose.trim()) {
      toast({ variant: "destructive", description: "출장 목적을 입력하세요." });
      return;
    }
    startTransition(async () => {
      const result = await submitTravelRequest({
        purpose: purpose.trim(),
        travelDate: travelDate || undefined,
        origin: origin.trim() || undefined,
        destination: destination.trim() || undefined,
        roundTrip,
        fuelType,
        distanceKm: num(distanceKm),
        fuelPricePerL: num(fuelPrice),
        fuelEfficiencyKmpl: num(efficiency),
        tollCost: num(tollCost),
        otherCost: num(otherCost),
        autoSource: autoSource ?? undefined,
        note: note.trim() || undefined,
      });
      if (result.ok) {
        toast({ description: "출장품의를 상신했습니다." });
        setPurpose("");
        setOrigin("");
        setDestination("");
        setDistanceKm("");
        setFuelPrice("");
        setTollCost("");
        setOtherCost("");
        setNote("");
        setAutoSource(null);
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  const autoAvailable = integration.fuelPrice || integration.distance;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>출장 목적</Label>
        <Input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="예: ○○기관 창업 멘토링 방문"
          disabled={pending}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>출장일</Label>
          <Input
            type="date"
            value={travelDate}
            onChange={(e) => setTravelDate(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label>연료</Label>
          <Select value={fuelType} onValueChange={onFuelTypeChange} disabled={pending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fuelTypes.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>출발지</Label>
          <Input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="예: 대전 유성구 …"
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label>도착지</Label>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="예: 서울 강남구 …"
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={roundTrip}
            onChange={(e) => setRoundTrip(e.target.checked)}
            disabled={pending}
          />
          왕복
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAutoCalc}
          disabled={pending}
          className="ml-auto"
        >
          <Calculator className="mr-1.5 h-4 w-4" />
          자동 계산
        </Button>
      </div>
      {!autoAvailable && (
        <p className="text-xs text-muted-foreground">
          거리·유가 자동 계산 API가 설정되지 않았습니다. 아래 값을 직접 입력하세요.
        </p>
      )}
      {autoIssues.length > 0 && (
        <div className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">
          <p className="font-semibold">자동 계산되지 않은 항목</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {autoIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
          <p className="mt-1">해당 값은 아래에서 직접 입력해 주세요.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>편도거리(km)</Label>
          <CommaNumberInput
            value={distanceKm}
            onValueChange={setDistanceKm}
            placeholder="0"
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label>유가(원/L)</Label>
          <CommaNumberInput
            value={fuelPrice}
            onValueChange={setFuelPrice}
            placeholder="0"
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label>연비(km/L)</Label>
          <CommaNumberInput
            value={efficiency}
            onValueChange={setEfficiency}
            disabled={pending}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>통행료(원)</Label>
          <CommaNumberInput
            value={tollCost}
            onValueChange={setTollCost}
            placeholder="0"
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label>기타(원)</Label>
          <CommaNumberInput
            value={otherCost}
            onValueChange={setOtherCost}
            placeholder="0"
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>메모 (선택)</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="flex items-center gap-3 rounded-md bg-secondary/60 p-3 text-sm">
        <span className="text-muted-foreground">유류비 {fuelCost.toLocaleString()}원</span>
        <span className="ml-auto font-semibold">
          합계 {total.toLocaleString()}원
        </span>
      </div>

      <Button type="button" className="w-full" onClick={onSubmit} disabled={pending}>
        {pending ? "처리 중..." : "출장품의 상신"}
      </Button>
    </div>
  );
}
