"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKrw } from "@/lib/approvals/constants";

import { updateProjectBudget } from "./slot-actions";

/**
 * 예산 대비 섭외비 현황.
 *  계획비 = Σ(슬롯 1인비용 × 필요인원) — 섭외 테이블 기준
 *  확정비 = Σ(수락된 섭외 비용) · 요청중 = Σ(회신 대기 중 섭외 비용)
 */
export function BudgetPanel({
  projectId,
  budgetAmount,
  plannedCost,
  requestedCost,
  confirmedCost,
  canManage,
}: {
  projectId: string;
  budgetAmount: number | null;
  plannedCost: number;
  requestedCost: number;
  confirmedCost: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(budgetAmount ? String(budgetAmount) : "");

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await updateProjectBudget(projectId, value);
      if (!r.ok) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  const committed = confirmedCost + requestedCost;
  const ratio =
    budgetAmount && budgetAmount > 0
      ? Math.min(100, Math.round((committed / budgetAmount) * 100))
      : null;
  const over = budgetAmount !== null && committed > budgetAmount;

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">총 예산</p>
          {editing ? (
            <div className="mt-1 flex items-center gap-1">
              <Input
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-8"
                placeholder="50000000"
              />
              <Button size="sm" onClick={save} disabled={pending}>
                저장
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                취소
              </Button>
            </div>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-lg font-bold">
              {budgetAmount !== null ? formatKrw(budgetAmount) : "미설정"}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="예산 수정"
                  className="text-muted-foreground hover:text-brand"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">섭외 계획비</p>
          <p className="mt-0.5 text-lg font-bold">{formatKrw(plannedCost)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">요청중</p>
          <p className="mt-0.5 text-lg font-bold text-amber-700">
            {formatKrw(requestedCost)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">확정비</p>
          <p className="mt-0.5 text-lg font-bold text-green-700">
            {formatKrw(confirmedCost)}
          </p>
        </div>
      </div>

      {ratio !== null && (
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              예산 소진 (확정 + 요청중)
            </span>
            <span className={over ? "font-bold text-red-600" : "text-muted-foreground"}>
              {formatKrw(committed)} / {formatKrw(budgetAmount!)} ({ratio}%)
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={
                "h-full rounded-full " + (over ? "bg-red-500" : "bg-brand")
              }
              style={{ width: `${ratio}%` }}
            />
          </div>
          {over && (
            <p className="mt-1 text-xs font-medium text-red-600">
              섭외비가 예산을 초과했습니다. 예산 또는 섭외 계획을 조정하세요.
            </p>
          )}
        </div>
      )}

      {budgetAmount === null && (
        <p className="text-xs text-muted-foreground">
          총 예산을 설정하면 섭외비 소진 현황을 함께 볼 수 있습니다.
        </p>
      )}
    </div>
  );
}
