"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import {
  saveProjectContributions,
  submitProjectClosing,
} from "../actions";

export type StaffOption = { id: string; name: string };

/**
 * 단계 23: 프로젝트 종료 — 기여도(합 100%) 입력 + 종료 상신.
 * 순위·집계 근거는 시스템이 계산(합계 강제). 종료는 품의 승인으로 확정된다.
 */
export function ProjectClosing({
  projectId,
  staff,
  initial,
  closingInProgress,
  approvalsActive,
  contributionsOnly = false,
}: {
  projectId: string;
  staff: StaffOption[];
  initial: Record<string, number>;
  closingInProgress: boolean;
  approvalsActive: boolean;
  /**
   * 참여율 입력만 쓴다 — 종료·지급 품의는 마감 탭의 절차가 몰아서 처리한다.
   * 종료 버튼이 두 곳에 있으면 어느 쪽이 진짜 종료인지 알 수 없다.
   */
  contributionsOnly?: boolean;
}) {
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [uid, pct] of Object.entries(initial)) out[uid] = String(pct);
    return out;
  });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const total = useMemo(
    () =>
      Object.values(shares).reduce((sum, v) => {
        const n = parseInt(v, 10);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [shares]
  );

  function setShare(userId: string, value: string) {
    if (value !== "" && !/^\d{1,3}$/.test(value)) return;
    setShares((prev) => ({ ...prev, [userId]: value }));
  }

  function collectRows() {
    return staff
      .map((s) => ({ userId: s.id, percentage: parseInt(shares[s.id] ?? "", 10) }))
      .filter((r) => Number.isFinite(r.percentage) && r.percentage > 0);
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveProjectContributions({
        projectId,
        rows: collectRows(),
      });
      if (result.ok) {
        toast({ description: "기여도를 저장했습니다." });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  function onSubmitClosing() {
    if (total !== 100) {
      toast({
        variant: "destructive",
        description: `기여도 합계가 100%가 아닙니다 (현재 ${total}%).`,
      });
      return;
    }
    if (
      !window.confirm(
        approvalsActive
          ? "종료 품의를 상신할까요? 승인되면 프로젝트가 종료됩니다."
          : "프로젝트를 종료할까요? 되돌릴 수 없습니다."
      )
    ) {
      return;
    }
    startTransition(async () => {
      // 상신 전 최신 기여도 저장
      const saved = await saveProjectContributions({
        projectId,
        rows: collectRows(),
      });
      if (!saved.ok) {
        toast({ variant: "destructive", description: saved.error });
        return;
      }
      const result = await submitProjectClosing(projectId);
      if (result.ok) {
        toast({
          description: result.submitted
            ? "종료 품의를 상신했습니다."
            : "프로젝트를 종료했습니다.",
        });
      } else {
        toast({ variant: "destructive", description: result.error });
      }
    });
  }

  if (closingInProgress) {
    return (
      <p className="text-sm text-muted-foreground">
        종료 품의가 진행 중입니다. 결재가 승인되면 프로젝트가 자동으로 종료됩니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        참여 직원의 참여율(기여도)을 입력하세요. 합계가{" "}
        <strong>정확히 100%</strong>여야 다음 단계로 넘어갑니다.{" "}
        {contributionsOnly
          ? "저장한 값은 임원 대시보드 성과 집계에 반영됩니다."
          : approvalsActive
            ? "종료는 품의 승인으로 확정됩니다."
            : "결재 없이 즉시 종료됩니다."}
      </p>
      <ul className="divide-y">
        {staff.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">{s.name}</span>
            <div className="flex items-center gap-1">
              <Input
                inputMode="numeric"
                className="h-8 w-20 text-right"
                value={shares[s.id] ?? ""}
                onChange={(e) => setShare(s.id, e.target.value)}
                placeholder="0"
                disabled={pending}
              />
              <span className="text-muted-foreground">%</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">합계</span>
        <Badge variant={total === 100 ? "default" : "destructive"}>{total}%</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={pending}
          >
            기여도 저장
          </Button>
          {!contributionsOnly && (
            <Button
              type="button"
              size="sm"
              onClick={onSubmitClosing}
              disabled={pending || total !== 100}
            >
              {approvalsActive ? "종료 품의 상신" : "프로젝트 종료"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
