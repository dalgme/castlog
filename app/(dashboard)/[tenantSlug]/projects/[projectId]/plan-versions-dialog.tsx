"use client";

import { useState, useTransition } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatKrw } from "@/lib/approvals/constants";
import {
  getEngagementPlanVersions,
  type PlanVersion,
} from "./plan-version-actions";

/**
 * 세션계획 버전 이력 다이얼로그 (기획 확정 2026-08-23).
 * 상신 1건 = 버전 1개. 최초 계획부터 현재까지 각 버전의 라인 스냅샷과
 * 결재자 수정 내역·반려 사유를 시간순으로 보여준다.
 */

const CHANGE_KIND_LABELS: Record<string, string> = {
  reorder: "순위 변경",
  remove: "후보 제외",
  fee: "예정가 수정",
};

export function PlanVersionsDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    startTransition(async () => {
      const result = await getEngagementPlanVersions(projectId);
      if (result.ok) setVersions(result.versions);
      else setError(result.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load(); // 열 때마다 재조회 — 새 상신이 있었을 수 있다
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <History className="mr-1 h-4 w-4" aria-hidden /> 버전
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>세션계획 버전 이력</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {pending && versions === null && (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        )}
        {versions !== null && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            아직 상신된 세션계획이 없습니다. 계획을 상신하면 버전 1이 기록됩니다.
          </p>
        )}
        <div className="space-y-4">
          {(versions ?? []).map((v) => (
            <div key={v.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">버전 {v.revision}</span>
                <Badge
                  variant={
                    v.statusLabel === "승인"
                      ? "default"
                      : v.statusLabel === "반려"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {v.statusLabel}
                </Badge>
                <span className="text-muted-foreground">
                  세션 {v.slotCount} · 후보 {v.positionCount} ·{" "}
                  {formatKrw(v.plannedAmount)}
                </span>
                {v.submittedAt && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    상신 {v.submittedAt.slice(0, 16).replace("T", " ")}
                  </span>
                )}
              </div>
              {v.rejectionNote && (
                <p className="mt-1.5 rounded bg-red-50 p-2 text-xs text-red-700">
                  반려 사유: {v.rejectionNote}
                </p>
              )}
              {v.note && (
                <p className="mt-1.5 text-xs text-muted-foreground">{v.note}</p>
              )}
              {v.lines.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                  {v.lines.map((l, i) => (
                    <li key={i}>
                      {l.slotDate}{" "}
                      {l.startsTime && l.endsTime
                        ? `${l.startsTime.slice(0, 5)}~${l.endsTime.slice(0, 5)}`
                        : ""}
                      {l.roleDescription ? ` · ${l.roleDescription}` : ""} ·{" "}
                      {l.requiredCount}명 · {formatKrw(l.feeAmount)}
                      {l.locationName ? ` · ${l.locationName}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {v.reviewChanges.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <p className="text-xs font-semibold text-brand-navy">
                    결재자 수정 내역
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {v.reviewChanges.map((c, i) => (
                      <li key={i}>
                        [{CHANGE_KIND_LABELS[c.kind] ?? c.kind}]{" "}
                        {c.positionCode ? `${c.positionCode} ` : ""}
                        {c.expertName ? `${c.expertName} ` : ""}
                        {c.beforeText || c.afterText
                          ? `${c.beforeText ?? ""} → ${c.afterText ?? ""}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          반려되면 그 시점의 상태(결재자 수정 포함)가 세션계획 등록 화면으로
          돌아오고, 승인된 계획을 변경하면 다시 승인 절차(변경 상신)를 거칩니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}
