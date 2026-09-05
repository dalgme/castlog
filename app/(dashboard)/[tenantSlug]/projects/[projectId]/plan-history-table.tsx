"use client";

import { useState } from "react";
import Link from "next/link";

import { REPORT_STATUS_LABELS, formatKrw } from "@/lib/approvals/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { ApprovedPlanRow } from "./engagement-progress";

const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "작성 중",
  in_progress: "결재 중",
  approved: "승인",
  rejected: "반려",
  superseded: "대체됨",
  withdrawn: "상신 취소",
};

const PLAN_STATUS_CLASS: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-900 border-emerald-200",
  in_progress: "bg-amber-100 text-amber-900 border-amber-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  superseded: "bg-secondary text-muted-foreground",
  withdrawn: "bg-secondary text-muted-foreground",
  draft: "bg-secondary text-muted-foreground",
};

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 섭외 품의 승인 목록 (기획 지시 2026-09-05): 기본은 **최종 승인된 계획만**.
 * '모든 승인 이력 확인'을 누르면 결재 중·반려·상신 취소·대체된 리비전까지
 * 상신 시각순으로 함께 본다 — 취소한 버전이 승인본과 나란히 뜨면 어느 것이
 * 유효한지 헷갈린다.
 */
export function PlanHistoryTable({
  tenantSlug,
  plans,
}: {
  tenantSlug: string;
  plans: ApprovedPlanRow[];
}) {
  const [showAll, setShowAll] = useState(false);
  const approved = plans.filter((p) => p.status === "approved");
  const visible = showAll
    ? plans
        .slice()
        .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""))
    : approved;
  const hiddenCount = plans.length - approved.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {showAll
            ? `전체 이력 ${plans.length}건 — 상신 시각순 (결재 중·반려·상신 취소·대체 포함)`
            : `최종 승인된 계획 ${approved.length}건`}
        </p>
        {hiddenCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "승인된 계획만 보기" : `모든 승인 이력 확인 (+${hiddenCount}건)`}
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {plans.length === 0
            ? "아직 상신된 섭외 품의가 없습니다. 섭외후보 등록 탭에서 세션별 후보를 배정한 뒤 품의를 올리면 여기에 쌓입니다."
            : "아직 승인된 계획이 없습니다. 결재 중이거나 반려·취소된 이력은 '모든 승인 이력 확인'에서 볼 수 있습니다."}
        </p>
      ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">리비전</TableHead>
                    <TableHead className="w-20">상태</TableHead>
                    <TableHead>담긴 세션</TableHead>
                    <TableHead className="w-24 text-right">인원</TableHead>
                    <TableHead className="w-28 text-right">계획 섭외비</TableHead>
                    <TableHead className="w-28">상신</TableHead>
                    <TableHead className="w-28">승인</TableHead>
                    <TableHead className="w-24">결재 문서</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">v{p.revision}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            PLAN_STATUS_CLASS[p.status] ?? PLAN_STATUS_CLASS.draft
                          )}
                        >
                          {PLAN_STATUS_LABELS[p.status] ?? p.status}
                        </span>
                        {p.postReport && (
                          <span
                            className="mt-1 block w-fit rounded-full bg-brand-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-coral-ink"
                            title="사후보고 모드로 즉시 확정된 계획"
                          >
                            사후보고
                            {p.reportStatus
                              ? ` · ${REPORT_STATUS_LABELS[p.reportStatus] ?? p.reportStatus}`
                              : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.sessionLabels.length === 0
                          ? `세션 ${p.slotCount}건 (세션 구분 없음)`
                          : p.sessionLabels.join(" · ")}
                        {/* 세션 세부 + 결재된 전문가별 예정가 — 접어 두고
                            필요할 때 편다 (모바일 조회 대응) */}
                        {p.sessions.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] font-semibold text-brand underline-offset-4 hover:underline">
                              세션 세부 · 승인 예정가 보기
                            </summary>
                            <ul className="mt-1.5 space-y-1.5">
                              {p.sessions.map((s, i) => (
                                <li
                                  key={`${p.id}-${s.slotId ?? i}`}
                                  className="rounded-md border bg-secondary/30 p-2"
                                >
                                  <p className="font-semibold">{s.label}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {[
                                      s.schedule,
                                      s.roleDescription,
                                      s.locationName,
                                      `필요 ${s.requiredCount}명`,
                                      `소계 ${formatKrw(s.subtotal)}`,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                  {s.experts.length > 0 ? (
                                    <ul className="mt-1 space-y-0.5">
                                      {s.experts.map((e) => (
                                        <li
                                          key={`${p.id}-${e.code}`}
                                          className="flex items-center justify-between gap-2 tabular-nums"
                                        >
                                          <span>
                                            <span className="font-mono text-[11px]">
                                              {e.code}
                                            </span>{" "}
                                            {e.name}
                                          </span>
                                          <span className="font-semibold text-brand-coral-ink">
                                            {formatKrw(e.fee)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      섭외 대상 전문가가 지문에 없습니다 (옛 계획).
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {p.note && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {p.note}
                          </p>
                        )}
                        {p.feedbackNote && (
                          <p className="mt-0.5 text-[11px] font-medium text-brand-coral-ink">
                            피드백: {p.feedbackNote}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {p.positionCount}명
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatKrw(p.plannedAmount)}
                      </TableCell>
                      <TableCell className="text-xs">{when(p.submittedAt)}</TableCell>
                      <TableCell className="text-xs">{when(p.approvedAt)}</TableCell>
                      <TableCell>
                        {p.approvalId ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/${tenantSlug}/approvals/${p.approvalId}`}
                              aria-label={`v${p.revision} 결재 문서 열기`}
                            >
                              열기
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
      )}
    </div>
  );
}
