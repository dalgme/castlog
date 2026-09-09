"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buildCostTotals, formatMoney, formatPercent } from "@/lib/quotes/calc";
import type { CostSheetKind, LoadedCostSheet } from "@/lib/quotes/cost-load";
import { EditableText } from "@/components/checklists/editable-cell";
import { MoneyInput } from "@/components/quotes/money-input";
import { QuoteLogsDialog } from "@/components/quotes/quote-logs-dialog";

import { getQuoteLogs } from "./quote-actions";
import {
  addCostLine,
  approveCostSheet,
  createCostSheet,
  deleteCostLine,
  grantCostSheetEdit,
  newCostSheetVersion,
  rejectCostSheet,
  resyncCostSheet,
  submitCostSheet,
  updateCostLine,
  updateCostSheet,
} from "./cost-actions";

const KIND_LABEL: Record<CostSheetKind, string> = {
  internal: "내부실견적서",
  settlement: "정산서",
};
const STATUS_LABEL = { draft: "작성 중", submitted: "결재 상신", confirmed: "확정" } as const;

/**
 * 내부실견적서 · 정산서 (기획 지시 2026-09-09 — 02·03).
 *
 * 왼쪽은 견적서에서 가져온 스냅샷이라 여기서 고칠 수 없다. 오른쪽에 지출과
 * 부가세 환급 대상만 적으면 환급액·수익·수익률이 즉시 계산된다.
 * 하단 세 영역(출장교통비·사업담당자 예비비·계약금액 부가세)은 항상 있다.
 */
export function CostPanel({
  projectId,
  kind,
  sheets,
  canEdit,
  users,
  latestQuoteVersion,
}: {
  projectId: string;
  kind: CostSheetKind;
  sheets: LoadedCostSheet[];
  canEdit: boolean;
  users: { id: string; name: string }[];
  latestQuoteVersion: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const mine = sheets.filter((s) => s.kind === kind);
  const [selectedId, setSelectedId] = useState<string | null>(mine[0]?.id ?? null);
  const sheet = mine.find((s) => s.id === selectedId) ?? mine[0] ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ variant: "destructive", description: r.error ?? "실패했습니다." });
      else {
        if (ok) toast({ description: ok });
        router.refresh();
      }
    });
  }

  if (mine.length === 0 || !sheet) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            아직 {KIND_LABEL[kind]}가 없습니다.{" "}
            {kind === "internal"
              ? "견적서 최신본의 항목과 금액을 그대로 가져와 왼쪽에 깔고, 오른쪽에 지출을 적습니다."
              : "확정된 내부실견적서의 지출을 나란히 보면서 실제 정산 지출을 적습니다."}
          </AlertDescription>
        </Alert>
        {canEdit && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(() => createCostSheet(projectId, kind), `${KIND_LABEL[kind]} 초안을 만들었습니다.`)}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> {KIND_LABEL[kind]} 만들기
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={`${KIND_LABEL[kind]} 버전`}>
          {mine.map((s) => {
            const active = s.id === sheet.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-input bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                v{s.version}
                <span className={cn("ml-1 text-[10px]", active ? "text-white/80" : "opacity-70")}>
                  {STATUS_LABEL[s.status]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto">
          <QuoteLogsDialog title={`${KIND_LABEL[kind]} v${sheet.version}`} load={() => getQuoteLogs(projectId, kind)} />
        </div>
      </div>
      <CostSheetCard
        sheet={sheet}
        kind={kind}
        canEdit={canEdit}
        users={users}
        latestQuoteVersion={latestQuoteVersion}
        pending={pending}
        run={run}
      />
    </div>
  );
}

function CostSheetCard({
  sheet,
  kind,
  canEdit,
  users,
  latestQuoteVersion,
  pending,
  run,
}: {
  sheet: LoadedCostSheet;
  kind: CostSheetKind;
  canEdit: boolean;
  users: { id: string; name: string }[];
  latestQuoteVersion: number | null;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
}) {
  const editable = canEdit && sheet.status === "draft";
  const totals = buildCostTotals(
    sheet.lines.map((l) => ({
      id: l.id,
      baseAmount: l.baseAmount,
      spend: l.spend,
      vatRefundable: l.vatRefundable,
    })),
    {
      travelAmount: sheet.travelAmount,
      travelRefundable: sheet.travelRefundable,
      reserveAmount: sheet.reserveAmount,
      reserveRefundable: sheet.reserveRefundable,
    },
    { baseVat: sheet.baseVat, baseTrimmed: sheet.baseTrimmed, baseProposal: sheet.baseProposal }
  );
  const showCompare = kind === "settlement" && sheet.lines.some((l) => l.compareSpend !== null);
  const staleQuote =
    kind === "internal" && latestQuoteVersion !== null && sheet.sourceVersion !== null
      ? latestQuoteVersion > sheet.sourceVersion
      : false;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm">
          {KIND_LABEL[kind]} <span className="text-[11px] font-normal text-muted-foreground">v{sheet.version}</span>
          <span
            className={cn(
              "ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal",
              sheet.status === "confirmed"
                ? "bg-emerald-100 text-emerald-800"
                : sheet.status === "submitted"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-700"
            )}
          >
            {STATUS_LABEL[sheet.status]}
            {sheet.status === "confirmed" && sheet.approvedByName ? ` · ${sheet.approvedByName}` : ""}
            {sheet.status === "submitted" && sheet.submittedByName ? ` · ${sheet.submittedByName}` : ""}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && sheet.status === "draft" && (
            <>
              {staleQuote && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => resyncCostSheet(sheet.id), "견적서 최신본을 반영했습니다.")}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> 견적 최신본 반영
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => submitCostSheet(sheet.id), "상급자 결재로 상신했습니다.")}
              >
                결재 상신
              </Button>
            </>
          )}
          {canEdit && sheet.status === "submitted" && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => approveCostSheet(sheet.id), "승인했습니다 — 확정 상태가 되었습니다.")}
              >
                승인(확정)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt("반려 사유를 입력하세요.");
                  if (reason && reason.trim()) run(() => rejectCostSheet(sheet.id, reason), "반려했습니다.");
                }}
              >
                반려
              </Button>
            </>
          )}
          {canEdit && sheet.status === "confirmed" && (
            <>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                수정 허용
                <select
                  value={sheet.editGrantTo ?? ""}
                  disabled={pending}
                  aria-label="수정 허용 담당자"
                  onChange={(e) =>
                    run(
                      () => grantCostSheetEdit(sheet.id, e.target.value || null),
                      e.target.value ? "이 담당자가 새 버전을 만들 수 있습니다." : "수정 허용을 해제했습니다."
                    )
                  }
                  className="rounded border border-input bg-white px-1 py-0.5 text-[11px]"
                >
                  <option value="">지정 안함</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => newCostSheetVersion(sheet.id), "새 버전 초안을 만들었습니다 — 재승인이 필요합니다.")}
              >
                새 버전 작성
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sheet.status === "confirmed" && (
          <Alert>
            <AlertDescription className="text-xs">
              확정된 문서입니다 — 내용을 고칠 수 없습니다. 상급자가 직접 ‘새 버전 작성’을 하거나, 상급자가
              ‘수정 허용’으로 지정한 담당자가 새 버전을 만들어 재승인을 받습니다. 이 버전은 그대로 보관됩니다.
              {sheet.editGrantToName && ` (현재 수정 허용: ${sheet.editGrantToName})`}
            </AlertDescription>
          </Alert>
        )}
        {sheet.status === "submitted" && (
          <Alert>
            <AlertDescription className="text-xs">
              결재 상신 중입니다. 작성자보다 상위 권한단계의 상급자가 승인하면 확정됩니다.
            </AlertDescription>
          </Alert>
        )}
        {staleQuote && sheet.status === "draft" && (
          <Alert>
            <AlertDescription className="text-xs">
              견적서가 v{latestQuoteVersion}로 갱신되었습니다. ‘견적 최신본 반영’을 누르면 왼쪽 금액이 최신
              견적으로 바뀝니다 — 적어 둔 지출은 순서대로 유지됩니다.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="제안금액" value={formatMoney(sheet.baseProposal)} />
          <Stat label="지출 합계" value={formatMoney(totals.spendTotal)} />
          <Stat
            label={kind === "internal" ? "예상 수익" : "정산 수익"}
            value={formatMoney(totals.profitTotal)}
            tone={totals.profitTotal < 0 ? "bad" : "good"}
          />
          <Stat
            label="수익률"
            value={formatPercent(totals.profitRatio)}
            tone={(totals.profitRatio ?? 0) < 0 ? "bad" : "good"}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="w-20 py-1 font-medium">항 목</th>
                <th className="w-48 py-1 pr-2 font-medium">세부내역 (견적)</th>
                <th className="w-28 py-1 pr-2 text-right font-medium">견적 금액</th>
                {showCompare && (
                  <>
                    <th className="w-40 py-1 pr-2 font-medium text-slate-500">내부실견적 비고</th>
                    <th className="w-24 py-1 pr-2 text-right font-medium text-slate-500">내부 지출</th>
                  </>
                )}
                <th className="py-1 pr-2 font-medium">비고</th>
                <th className="w-28 py-1 pr-2 text-right font-medium">지출</th>
                <th className="w-16 py-1 pr-2 text-center font-medium">환급</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">환급액</th>
                <th className="w-28 py-1 pr-2 text-right font-medium">수익</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sheet.lines.map((line) => {
                const res = totals.lines[line.id] ?? { refund: 0, profit: 0 };
                return (
                  <tr key={line.id} className="align-top">
                    <td className="py-1 pr-2 text-muted-foreground">{line.baseSection ?? ""}</td>
                    <td className="py-1 pr-2">{line.baseName ?? <span className="text-muted-foreground">(추가 항목)</span>}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(line.baseAmount)}</td>
                    {showCompare && (
                      <>
                        <td className="py-1 pr-2 text-slate-500">{line.compareNote ?? ""}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-slate-500">
                          {line.compareSpend === null ? "" : formatMoney(line.compareSpend)}
                        </td>
                      </>
                    )}
                    <td className="py-0.5 pr-2">
                      <EditableText
                        value={line.note}
                        disabled={!editable}
                        placeholder="지출 내역"
                        onSave={(v) => run(() => updateCostLine(line.id, { note: v }))}
                      />
                    </td>
                    <td className="py-0.5 pr-2">
                      <MoneyInput
                        value={line.spend}
                        disabled={!editable}
                        ariaLabel={`${line.baseName ?? "추가 항목"} 지출`}
                        onCommit={(v) => run(() => updateCostLine(line.id, { spend: v }))}
                      />
                    </td>
                    <td className="py-1 text-center">
                      <Checkbox
                        checked={line.vatRefundable}
                        disabled={!editable}
                        aria-label={`${line.baseName ?? "추가 항목"} 부가세 환급 대상`}
                        onCheckedChange={(v) => run(() => updateCostLine(line.id, { vatRefundable: v === true }))}
                      />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                      {res.refund === 0 ? "-" : formatMoney(res.refund)}
                    </td>
                    <td className={cn("py-1 pr-2 text-right tabular-nums", res.profit < 0 && "text-red-600")}>
                      {formatMoney(res.profit)}
                    </td>
                    <td className="py-0.5 text-right">
                      {editable && line.baseName === null && (
                        <button
                          type="button"
                          title="추가 항목 삭제"
                          className="rounded p-1 text-muted-foreground hover:text-red-600"
                          disabled={pending}
                          onClick={() => run(() => deleteCostLine(line.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* ── 하단 필수 영역 (기획 지시 02·03) ────────────────────── */}
              <FixedRow
                label="출장교통비"
                note={sheet.travelNote}
                amount={sheet.travelAmount}
                refundable={sheet.travelRefundable}
                refund={totals.travel.refund}
                profit={totals.travel.profit}
                editable={editable}
                showCompare={showCompare}
                onNote={(v) => run(() => updateCostSheet(sheet.id, { travelNote: v }))}
                onAmount={(v) => run(() => updateCostSheet(sheet.id, { travelAmount: v }))}
                onRefundable={(v) => run(() => updateCostSheet(sheet.id, { travelRefundable: v }))}
              />
              <FixedRow
                label="사업담당자 예비비"
                note={sheet.reserveNote}
                amount={sheet.reserveAmount}
                refundable={sheet.reserveRefundable}
                refund={totals.reserve.refund}
                profit={totals.reserve.profit}
                editable={editable}
                showCompare={showCompare}
                onNote={(v) => run(() => updateCostSheet(sheet.id, { reserveNote: v }))}
                onAmount={(v) => run(() => updateCostSheet(sheet.id, { reserveAmount: v }))}
                onRefundable={(v) => run(() => updateCostSheet(sheet.id, { reserveRefundable: v }))}
              />
              <tr className="bg-secondary/50 align-top font-medium">
                <td className="py-1 pr-2">계약금액 부가세</td>
                <td className="py-1 pr-2 text-muted-foreground">계약 부가세 − 환급 합계 = 납부액</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(sheet.baseVat)}</td>
                {showCompare && <><td /><td /></>}
                <td className="py-1 pr-2 text-muted-foreground">자동 계산</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(totals.vatRow.spend)}</td>
                <td />
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {formatMoney(totals.refundTotal)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(totals.vatRow.profit)}</td>
                <td />
              </tr>
              {sheet.baseTrimmed > 0 && (
                <tr className="align-top text-muted-foreground">
                  <td className="py-1 pr-2">절사액</td>
                  <td className="py-1 pr-2">제안가 절사로 받지 못하는 금액</td>
                  <td />
                  {showCompare && <><td /><td /></>}
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="py-1 pr-2 text-right tabular-nums text-red-600">
                    −{formatMoney(sheet.baseTrimmed)}
                  </td>
                  <td />
                </tr>
              )}
              <tr className="border-t-2 bg-secondary font-bold">
                <td className="py-1.5 pr-2" colSpan={showCompare ? 5 : 3}>
                  합 계
                </td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground">지출</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatMoney(totals.spendTotal)}</td>
                <td />
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatMoney(totals.refundTotal)}</td>
                <td className={cn("py-1.5 pr-2 text-right tabular-nums", totals.profitTotal < 0 && "text-red-600")}>
                  {formatMoney(totals.profitTotal)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {editable && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => addCostLine(sheet.id, null))}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> 견적에 없는 지출 추가
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border bg-secondary/40 px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <p className={cn("text-base font-bold tabular-nums", tone === "bad" && "text-red-600")}>{value}</p>
    </div>
  );
}

function FixedRow({
  label,
  note,
  amount,
  refundable,
  refund,
  profit,
  editable,
  showCompare,
  onNote,
  onAmount,
  onRefundable,
}: {
  label: string;
  note: string | null;
  amount: number;
  refundable: boolean;
  refund: number;
  profit: number;
  editable: boolean;
  showCompare: boolean;
  onNote: (v: string | null) => void;
  onAmount: (v: number) => void;
  onRefundable: (v: boolean) => void;
}) {
  return (
    <tr className="bg-secondary/50 align-top font-medium">
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2 text-muted-foreground">필수 영역</td>
      <td />
      {showCompare && <><td /><td /></>}
      <td className="py-0.5 pr-2 font-normal">
        <EditableText value={note} disabled={!editable} placeholder="내역" onSave={onNote} />
      </td>
      <td className="py-0.5 pr-2 font-normal">
        <MoneyInput value={amount} disabled={!editable} ariaLabel={label} onCommit={onAmount} />
      </td>
      <td className="py-1 text-center">
        <Checkbox
          checked={refundable}
          disabled={!editable}
          aria-label={`${label} 부가세 환급 대상`}
          onCheckedChange={(v) => onRefundable(v === true)}
        />
      </td>
      <td className="py-1 pr-2 text-right tabular-nums font-normal text-muted-foreground">
        {refund === 0 ? "-" : formatMoney(refund)}
      </td>
      <td className={cn("py-1 pr-2 text-right tabular-nums", profit < 0 && "text-red-600")}>
        {formatMoney(profit)}
      </td>
      <td />
    </tr>
  );
}
