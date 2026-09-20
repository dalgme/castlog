"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, CheckCircle2, Lock, RotateCcw, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatKrw } from "@/lib/approvals/constants";

import {
  createSessionPaymentBatch,
  markBatchPaid,
  resubmitSessionBatch,
} from "../../payments/actions";
import { closeProjectAfterPayments } from "./closing-actions";
import { SessionAttachDialog, type SessionAttachment } from "./session-attach-dialog";

/**
 * 지급 품의 탭 (기획 지시 2026-09-21).
 *
 * 세션 단위로 종료(전문가 평가·완료)가 끝난 세션이 이 탭에 온다. 단일 세션 또는 여러 세션을
 * 묶어 지급 품의를 올리면 '결재 중' → 결재가 나면 '결재 승인' → 지급 뒤 '지급 완료'를 누른다.
 * 지급 건(expert_payment_batches)은 비용·지급 화면과 같은 기록이다 — 여기서 올린 품의가
 * 그 화면과 지급 내보내기(비즈로그 연동 시트)에 그대로 보인다.
 */

export type PaymentLine = {
  engagementId: string;
  expertName: string;
  code: string | null;
  /** 의뢰비용 — 비어 있으면 예정가로 대신(fallback=true) */
  gross: number | null;
  fallback: boolean;
  completed: boolean;
  evaluated: boolean;
  /** 살아 있는 지급 건에 담겨 있으면 그 id */
  batchId: string | null;
};

export type PaymentSessionRow = {
  slotId: string;
  label: string;
  detail: string | null;
  lines: PaymentLine[];
  /** 모든 계약 성립 건이 종료·평가 완료 */
  eligible: boolean;
};

export type PaymentBatchRow = {
  id: string;
  title: string;
  status: string;
  totalGross: number;
  approvalId: string | null;
  rejectionNote: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  /** 이 지급 건에 담긴 세션 표기 */
  slotLabels: string[];
};

const BATCH_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "결재 대기", className: "bg-amber-100 text-amber-900 border-amber-300" },
  approval_in_progress: { label: "결재 중", className: "bg-sky-100 text-sky-900 border-sky-300" },
  confirmed: { label: "결재 승인", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  paid: { label: "지급 완료", className: "bg-violet-600 text-white border-violet-600" },
  canceled: { label: "취소", className: "bg-neutral-200 text-neutral-700 border-neutral-300" },
};

function StatusBadge({ status }: { status: string }) {
  const s = BATCH_STATUS[status] ?? { label: status, className: "" };
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold", s.className)}>
      {s.label}
    </span>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function ClosingTab({
  tenantSlug,
  projectId,
  hasExperts,
  expertsLite = false,
  sessions,
  batches,
  canSubmit,
  canMarkPaid,
  canSeeAmounts,
  canClose,
  isClosed,
  closedAt,
  attachmentsBySlot = {},
  canAttach,
}: {
  tenantSlug: string;
  projectId: string;
  hasExperts: boolean;
  expertsLite?: boolean;
  sessions: PaymentSessionRow[];
  batches: PaymentBatchRow[];
  /** 지급 품의 상신 — PL·PM·부PM 또는 지급 권한자 */
  canSubmit: boolean;
  /** 지급 완료 처리 — 지급 권한자(대표·이사·지급 위임자) */
  canMarkPaid: boolean;
  /** 금액 표시 — 지급 권한자 또는 프로젝트 팀 */
  canSeeAmounts: boolean;
  /** 프로젝트 종료 — 관리자 이상 */
  canClose: boolean;
  isClosed: boolean;
  closedAt: string | null;
  /** 세션별 첨부 (slotId → 파일들) — 기획 2026-09-21 */
  attachmentsBySlot?: Record<string, SessionAttachment[]>;
  /** 첨부 등록·삭제 — 프로젝트 팀 */
  canAttach: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const selectable = sessions.filter((s) => s.eligible && s.lines.every((l) => l.batchId === null));
  const waiting = sessions.filter((s) => !s.eligible && s.lines.every((l) => l.batchId === null));
  const allPaid =
    sessions.length > 0 &&
    sessions.every((s) => s.lines.length === 0 || s.lines.every((l) => l.batchId && batchById.get(l.batchId)?.status === "paid"));

  function toggle(slotId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  }

  function submit() {
    const slotIds = Array.from(selected);
    if (slotIds.length === 0) return;
    if (!window.confirm(`고른 ${slotIds.length}개 세션의 지급 품의를 올릴까요? 상신 뒤에는 결재가 끝날 때까지 되돌릴 수 없습니다.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await createSessionPaymentBatch({ projectId, slotIds });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSelected(new Set());
      toast({
        description: r.submitted
          ? "지급 품의를 올렸습니다. 결재가 끝나면 '결재 승인'으로 바뀝니다."
          : `지급 건은 만들었지만 결재 상신은 되지 않았습니다: ${r.warning ?? "재상신 버튼으로 다시 올려 주세요."}`,
      });
      router.refresh();
    });
  }

  function paid(batchId: string) {
    if (!window.confirm("이 지급 건의 지급을 완료한 것으로 기록할까요? 실제 이체는 시스템 밖에서 이루어집니다.")) return;
    setError(null);
    startTransition(async () => {
      const r = await markBatchPaid(batchId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: "지급 완료로 기록했습니다." });
      router.refresh();
    });
  }

  function resubmit(batchId: string) {
    setError(null);
    startTransition(async () => {
      const r = await resubmitSessionBatch({ projectId, batchId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: "지급 품의를 다시 올렸습니다." });
      router.refresh();
    });
  }

  function close() {
    if (!window.confirm("모든 세션의 지급이 끝났습니다. 프로젝트를 종료할까요? 종료 뒤에는 되돌릴 수 없습니다.")) return;
    setError(null);
    startTransition(async () => {
      const r = await closeProjectAfterPayments(projectId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ description: "프로젝트를 종료했습니다." });
      router.refresh();
    });
  }

  if (!hasExperts) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          전문가 모듈을 쓰지 않는 회사입니다. 참여율 배분 탭에서 참여율을 정리한 뒤 그 탭에서 종료를 상신합니다.
        </CardContent>
      </Card>
    );
  }

  const th = "border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold";
  const td = "border px-2 py-1.5 text-sm align-top";

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {expertsLite && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 flex-none" aria-hidden />
          라이트 모드 — 지급 기능을 쓰지 않습니다. 설정 &gt; 기업관리에서 라이트 모드를 끄면 지급 품의를 올릴 수 있습니다.
        </p>
      )}

      {/* ① 지급 품의 대상 세션 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm">지급 품의 대상 세션</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              섭외 확정 탭에서 세션의 모든 전문가가 종료(평가·완료)되면 여기서 고를 수 있습니다. 한 세션만, 또는
              여러 세션을 묶어 한 번에 품의를 올립니다.
            </p>
          </div>
          {canSubmit && !expertsLite && (
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={submit}
              disabled={pending || selected.size === 0}
              title={selected.size === 0 ? "지급 품의할 세션을 고르세요" : undefined}
            >
              <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
              선택 세션 지급 품의 상신{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">계약 성립(승인)된 전문가가 있는 세션이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead>
                  <tr>
                    {canSubmit && <th className={cn(th, "w-10")}>선택</th>}
                    <th className={cn(th, "text-left")}>세션</th>
                    <th className={cn(th, "text-left")}>전문가 (코드넘버)</th>
                    <th className={cn(th, "w-28")}>종료·평가</th>
                    {canSeeAmounts && <th className={cn(th, "w-32")}>금액</th>}
                    <th className={cn(th, "w-28")}>파일 첨부</th>
                    <th className={cn(th, "w-28")}>지급 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const batchIds = Array.from(new Set(s.lines.map((l) => l.batchId).filter((v): v is string => Boolean(v))));
                    const batch = batchIds.length === 1 ? batchById.get(batchIds[0] as string) : undefined;
                    const isSelectable = s.eligible && batchIds.length === 0;
                    const doneCount = s.lines.filter((l) => l.completed && l.evaluated).length;
                    const subtotal = s.lines.reduce((sum, l) => sum + (l.gross ?? 0), 0);
                    const anyFallback = s.lines.some((l) => l.fallback);
                    return (
                      <tr
                        key={s.slotId}
                        className={cn(
                          batch?.status === "paid" && "bg-violet-50",
                          batch?.status === "confirmed" && "bg-emerald-50/60",
                          batch?.status === "approval_in_progress" && "bg-sky-50/60",
                          !s.eligible && batchIds.length === 0 && "bg-neutral-50 text-muted-foreground"
                        )}
                      >
                        {canSubmit && (
                          <td className={cn(td, "text-center")}>
                            {isSelectable ? (
                              <Checkbox
                                checked={selected.has(s.slotId)}
                                onCheckedChange={() => toggle(s.slotId)}
                                disabled={pending || expertsLite}
                                aria-label={`${s.label} 선택`}
                              />
                            ) : null}
                          </td>
                        )}
                        <td className={td}>
                          <div className="font-semibold">{s.label}</div>
                          {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
                        </td>
                        <td className={td}>
                          <ul className="space-y-0.5">
                            {s.lines.map((l) => (
                              <li key={l.engagementId} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="font-medium">{l.expertName}</span>
                                {l.code && <span className="text-muted-foreground">({l.code})</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className={cn(td, "text-center text-xs")}>
                          {s.eligible ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-violet-700">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                              종료 {doneCount}/{s.lines.length}
                            </span>
                          ) : (
                            <span title="섭외 확정 탭에서 전문가별 '평가'(완료 = 종료)를 마쳐야 합니다">
                              종료 {doneCount}/{s.lines.length}
                            </span>
                          )}
                        </td>
                        {canSeeAmounts && (
                          <td className={cn(td, "text-right tabular-nums text-xs")}>
                            {formatKrw(subtotal)}
                            {anyFallback && (
                              <div className="text-[10px] text-amber-700" title="의뢰비용이 비어 있어 코드넘버 자리의 예정가로 계산합니다">
                                예정가 기준
                              </div>
                            )}
                          </td>
                        )}
                        <td className={cn(td, "text-center")}>
                          <SessionAttachDialog
                            projectId={projectId}
                            slotId={s.slotId}
                            sessionLabel={s.label}
                            attachments={attachmentsBySlot[s.slotId] ?? []}
                            canManage={canAttach && !isClosed}
                          />
                        </td>
                        <td className={cn(td, "text-center")}>
                          {batchIds.length > 1 ? (
                            <span className="text-xs text-muted-foreground">여러 지급 건</span>
                          ) : batch ? (
                            <StatusBadge status={batch.status} />
                          ) : s.eligible ? (
                            <span className="text-xs text-emerald-700">품의 가능</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">종료 대기</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canSubmit && selectable.length === 0 && waiting.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              아직 종료 대기 중인 세션만 남아 있습니다. 섭외 확정 탭에서 전문가별 「평가」를 마치면 여기서 고를 수 있습니다.
            </p>
          )}
          {!canSubmit && (
            <p className="mt-2 text-xs text-muted-foreground">
              지급 품의 상신은 이 프로젝트의 PL·PM·부PM 또는 지급 권한자(대표·이사·지급 위임자)가 합니다 (권한 규칙).
            </p>
          )}
        </CardContent>
      </Card>

      {/* ② 지급 품의 목록 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">지급 품의 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 올린 지급 품의가 없습니다.</p>
          ) : (
            <ul className="divide-y">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={b.status} />
                      <span className="text-sm font-semibold">{b.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      세션: {b.slotLabels.length > 0 ? b.slotLabels.join(" · ") : "-"}
                      {canSeeAmounts && ` · 총 ${formatKrw(b.totalGross)}`}
                      {` · 상신 ${fmtWhen(b.createdAt)}`}
                      {b.status === "confirmed" && b.confirmedAt && ` · 승인 ${fmtWhen(b.confirmedAt)}`}
                      {b.status === "paid" && b.paidAt && ` · 지급 ${fmtWhen(b.paidAt)}`}
                    </div>
                    {b.status === "pending" && b.rejectionNote && (
                      <div className="text-xs text-red-700">반려: {b.rejectionNote}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.approvalId && (
                      <Button asChild type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">
                        <Link href={`/${tenantSlug}/approvals/${b.approvalId}`}>결재 건 보기</Link>
                      </Button>
                    )}
                    {b.status === "pending" && canSubmit && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => resubmit(b.id)}
                        disabled={pending}
                      >
                        <RotateCcw className="mr-0.5 h-3 w-3" aria-hidden />
                        재상신
                      </Button>
                    )}
                    {b.status === "confirmed" &&
                      (canMarkPaid ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-violet-600 px-2 text-[11px] text-white hover:bg-violet-700"
                          onClick={() => paid(b.id)}
                          disabled={pending}
                        >
                          <BadgeCheck className="mr-0.5 h-3 w-3" aria-hidden />
                          지급 완료
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">지급 완료는 지급 권한자가 처리</span>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ③ 프로젝트 종료 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">프로젝트 종료</CardTitle>
          {isClosed ? (
            <Badge>{closedAt ? `${new Date(closedAt).toLocaleDateString("ko-KR")} 종료` : "종료"}</Badge>
          ) : allPaid && canClose ? (
            <Button type="button" size="sm" onClick={close} disabled={pending}>
              프로젝트 종료
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {isClosed
              ? "종료된 프로젝트입니다. 참여율은 임원 대시보드 성과 집계에 반영됩니다."
              : allPaid
                ? canClose
                  ? "모든 세션의 지급이 끝났습니다. 프로젝트를 종료할 수 있습니다."
                  : "모든 세션의 지급이 끝났습니다. 종료는 관리자 이상이 합니다 (권한 규칙)."
                : "모든 세션의 지급 품의가 '지급 완료'가 되면 프로젝트를 종료할 수 있습니다."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
