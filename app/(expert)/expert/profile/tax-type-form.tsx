"use client";

import { useState, useTransition } from "react";

import { PAYMENT_TYPE_LABELS } from "@/lib/payments/tax";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import { setExpertTaxType } from "./actions";

const TYPE_DESCRIPTIONS: Record<string, string> = {
  business_income: "개인 — 원천징수 3.3% (소득세 3% + 지방소득세 0.3%)",
  other_income: "개인 — 필요경비 60% 인정, 실효 8.8% 원천징수",
  business: "사업자 — 원천징수 없음, 세금계산서 발행",
};

/**
 * 소득유형 설정 (기획 확정 — 전문가 본인이 대시보드에서 구분/설정)
 * 기업의 지급 품의는 이 설정을 기준으로 실지급/원천징수/총비용을 계산한다.
 */
export function TaxTypeForm({
  currentType,
  currentBizNumber,
}: {
  currentType: string | null;
  currentBizNumber: string | null;
}) {
  const [selected, setSelected] = useState<string>(currentType ?? "");
  const [bizNumber, setBizNumber] = useState(currentBizNumber ?? "");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function onSave() {
    if (
      selected !== "business_income" &&
      selected !== "other_income" &&
      selected !== "business"
    ) {
      toast({ variant: "destructive", description: "소득유형을 선택하세요." });
      return;
    }
    startTransition(async () => {
      const result = await setExpertTaxType({
        paymentType: selected,
        businessRegistrationNumber:
          selected === "business" ? bizNumber || undefined : undefined,
      });
      if (result.ok) {
        toast({ description: "소득유형이 저장되었습니다." });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      {!currentType && (
        <Alert>
          <AlertDescription>
            소득유형이 설정되지 않았습니다. 설정 전에는 기업이 지급 품의를
            진행할 수 없습니다.
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        {(["business_income", "other_income", "business"] as const).map((type) => (
          <label
            key={type}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm ${
              selected === type ? "border-brand bg-brand/5" : ""
            }`}
          >
            <input
              type="radio"
              name="paymentType"
              value={type}
              checked={selected === type}
              onChange={() => setSelected(type)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{PAYMENT_TYPE_LABELS[type]}</span>
              <span className="block text-xs text-muted-foreground">
                {TYPE_DESCRIPTIONS[type]}
              </span>
            </span>
          </label>
        ))}
      </div>
      {selected === "business" && (
        <div>
          <p className="mb-1.5 text-xs font-medium">사업자등록번호 (선택)</p>
          <Input
            value={bizNumber}
            onChange={(e) => setBizNumber(e.target.value)}
            placeholder="123-45-67890"
            maxLength={12}
            inputMode="numeric"
          />
        </div>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={pending}
        onClick={onSave}
      >
        {pending ? "저장 중..." : "소득유형 저장"}
      </Button>
      <p className="text-xs text-muted-foreground">
        변경 사항은 이후 지급 건부터 적용되며, 이미 상신된 지급 품의에는
        소급되지 않습니다. 원천징수액은 참고 계산입니다.
      </p>
    </div>
  );
}
