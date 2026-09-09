"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, GripVertical, Plus, Printer, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ROUNDING_LABELS,
  ROUNDING_MODES,
  buildQuoteTotals,
  formatMoney,
  type RoundingMode,
} from "@/lib/quotes/calc";
import { EditableText } from "@/components/checklists/editable-cell";
import { MoneyInput, PercentInput } from "@/components/quotes/money-input";
import { QuoteLogsDialog } from "@/components/quotes/quote-logs-dialog";

import {
  addQuoteItem,
  createQuote,
  deleteQuote,
  deleteQuoteItem,
  getQuoteLogs,
  issueQuote,
  newQuoteVersion,
  reorderQuoteItems,
  updateQuote,
  updateQuoteItem,
  type QuoteItemPatch,
  type QuotePatch,
} from "./quote-actions";

export type QuoteItemView = {
  id: string;
  section: string | null;
  name: string;
  qty: number;
  qtyUnit: string | null;
  times: number;
  timesUnit: string | null;
  days: number;
  daysUnit: string | null;
  unitPrice: number;
};

export type QuoteView = {
  id: string;
  version: number;
  status: "draft" | "issued";
  title: string;
  headcount: string | null;
  periodText: string | null;
  quoteDate: string | null;
  validText: string | null;
  clientName: string | null;
  supplierName: string | null;
  supplierRegNo: string | null;
  supplierCeo: string | null;
  supplierAddress: string | null;
  supplierBizType: string | null;
  supplierBizItem: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  indirectLabel: string;
  indirectRate: number;
  profitLabel: string;
  profitRate: number;
  vatRate: number;
  rounding: RoundingMode;
  note: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  updatedAt: string;
  items: QuoteItemView[];
};

/**
 * 프로젝트 견적서 (기획 지시 2026-09-09 — 01).
 * 세부내역을 고치면 금액·소계·합계가 즉시 다시 계산되고(서버와 같은 식),
 * 발행하면 잠긴다. 고쳐야 하면 새 버전을 만들고 발행본은 그대로 남는다.
 */
export function QuotePanel({
  tenantSlug,
  projectId,
  quotes,
  canEdit,
}: {
  tenantSlug: string;
  projectId: string;
  quotes: QuoteView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const versionKey = quotes.map((q) => q.id).join(",");
  const [selectedId, setSelectedId] = useState<string | null>(quotes[0]?.id ?? null);
  useEffect(() => {
    const ids = quotes.map((q) => q.id);
    setSelectedId((cur) => (cur && ids.includes(cur) ? cur : (ids[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey]);
  const quote = quotes.find((q) => q.id === selectedId) ?? quotes[0] ?? null;

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

  if (quotes.length === 0) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            아직 이 프로젝트의 견적서가 없습니다.{" "}
            {canEdit
              ? "‘견적서 만들기’를 누르면 사업명·기간·발주처와 회사 정보가 자동으로 채워진 초안이 만들어집니다."
              : "프로젝트 팀(PL·PM·부PM·담당)이 만들면 여기에 표시됩니다."}
          </AlertDescription>
        </Alert>
        {canEdit && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(() => createQuote(projectId), "견적서 초안을 만들었습니다.")}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> 견적서 만들기
          </Button>
        )}
      </div>
    );
  }
  if (!quote) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="견적서 버전">
          {quotes.map((q) => {
            const active = q.id === quote.id;
            return (
              <button
                key={q.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(q.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-input bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                v{q.version}
                <span className={cn("ml-1 text-[10px]", active ? "text-white/80" : "opacity-70")}>
                  {q.status === "issued" ? "발행" : "작성 중"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <QuoteLogsDialog title={`견적서 v${quote.version}`} load={() => getQuoteLogs(projectId, "quote")} />
          <Button asChild variant="outline" size="sm">
            <a href={`/${tenantSlug}/projects/${projectId}/quote/${quote.id}/export`}>
              <FileSpreadsheet className="mr-1 h-3.5 w-3.5" aria-hidden /> 엑셀
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/${tenantSlug}/projects/${projectId}/quote/${quote.id}/print`} target="_blank" rel="noreferrer">
              <Printer className="mr-1 h-3.5 w-3.5" aria-hidden /> 인쇄·PDF
            </a>
          </Button>
        </div>
      </div>

      <QuoteCard
        quote={quote}
        canEdit={canEdit && quote.status === "draft"}
        canManage={canEdit}
        pending={pending}
        run={run}
        onCreateVersion={() =>
          run(() => newQuoteVersion(quote.id), `v${quote.version} 내용을 복사한 새 버전을 만들었습니다.`)
        }
      />
    </div>
  );
}

function QuoteCard({
  quote,
  canEdit,
  canManage,
  pending,
  run,
  onCreateVersion,
}: {
  quote: QuoteView;
  canEdit: boolean;
  canManage: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
  onCreateVersion: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const serverIds = quote.items.map((i) => i.id);
  const serverKey = serverIds.join(",");
  useEffect(() => {
    setOrder(null);
  }, [serverKey]);
  const ids = order ?? serverIds;
  const byId = new Map(quote.items.map((i) => [i.id, i]));
  const ordered = ids.map((id) => byId.get(id)).filter((i): i is QuoteItemView => Boolean(i));

  const totals = buildQuoteTotals(
    ordered.map((i) => ({
      id: i.id,
      section: i.section,
      qty: i.qty,
      times: i.times,
      days: i.days,
      unitPrice: i.unitPrice,
    })),
    {
      indirectRate: quote.indirectRate,
      profitRate: quote.profitRate,
      vatRate: quote.vatRate,
      rounding: quote.rounding,
    }
  );

  function patchDoc(patch: QuotePatch, label?: string) {
    run(() => updateQuote(quote.id, patch), label);
  }
  function patchItem(id: string, patch: QuoteItemPatch) {
    run(() => updateQuoteItem(id, patch));
  }
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return setDragId(null);
    const next = ids.filter((id) => id !== dragId);
    next.splice(next.indexOf(targetId), 0, dragId);
    setOrder(next);
    setDragId(null);
    run(() => reorderQuoteItems(quote.id, next));
  }

  // 소계 행을 어디에 끼울지 — 묶음의 마지막 항목 id
  const lastOfSection = new Map<string, { name: string | null; subtotal: number; index: number }>();
  totals.sections.forEach((s, i) => {
    const last = s.itemIds[s.itemIds.length - 1];
    if (last) lastOfSection.set(last, { name: s.name, subtotal: s.subtotal, index: i });
  });
  const SECTION_MARKS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm">
          견 적 서 <span className="text-[11px] font-normal text-muted-foreground">v{quote.version}</span>
          {quote.status === "issued" && (
            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-normal text-emerald-800">
              발행 {quote.issuedAt?.slice(0, 10)} {quote.issuedByName ?? ""}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && quote.status === "draft" && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("이 버전을 발행할까요? 발행하면 내용이 잠기고, 이후 수정은 새 버전으로만 가능합니다."))
                    run(() => issueQuote(quote.id), "견적서를 발행했습니다.");
                }}
              >
                발행
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`v${quote.version} 초안을 지울까요? 변경 로그는 남습니다.`))
                    run(() => deleteQuote(quote.id), "초안을 지웠습니다.");
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> 초안 삭제
              </Button>
            </>
          )}
          {canManage && quote.status === "issued" && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCreateVersion}>
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> 새 버전 작성
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {quote.status === "issued" && (
          <Alert>
            <AlertDescription className="text-xs">
              발행된 견적서입니다 — 내용을 고칠 수 없습니다. 수정이 필요하면 ‘새 버전 작성’을 누르세요.
              이 버전은 그대로 보관되고, 변경 내역은 로그에 남습니다.
            </AlertDescription>
          </Alert>
        )}

        {/* ── 상단 정보 (기획 지시 09 — 자동 채움) ─────────────────────── */}
        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <Field label="사업명" value={quote.title} disabled={!canEdit} onSave={(v) => patchDoc({ title: v ?? "" })} />
          <Field label="상호" value={quote.supplierName} disabled={!canEdit} onSave={(v) => patchDoc({ supplierName: v })} />
          <Field label="기준인원" value={quote.headcount} disabled={!canEdit} onSave={(v) => patchDoc({ headcount: v })} />
          <Field label="등록번호" value={quote.supplierRegNo} disabled={!canEdit} onSave={(v) => patchDoc({ supplierRegNo: v })} />
          <Field label="기간" value={quote.periodText} disabled={!canEdit} onSave={(v) => patchDoc({ periodText: v })} />
          <Field label="대표이사" value={quote.supplierCeo} disabled={!canEdit} onSave={(v) => patchDoc({ supplierCeo: v })} />
          <Field label="견적일" value={quote.quoteDate} disabled={!canEdit} onSave={(v) => patchDoc({ quoteDate: v })} placeholder="yyyy-mm-dd" />
          <Field label="사업자주소" value={quote.supplierAddress} disabled={!canEdit} multiline onSave={(v) => patchDoc({ supplierAddress: v })} />
          <Field label="견적유효기간" value={quote.validText} disabled={!canEdit} onSave={(v) => patchDoc({ validText: v })} />
          <Field label="업태" value={quote.supplierBizType} disabled={!canEdit} onSave={(v) => patchDoc({ supplierBizType: v })} />
          <Field label="견적 대상" value={quote.clientName} disabled={!canEdit} onSave={(v) => patchDoc({ clientName: v })} />
          <Field label="종목" value={quote.supplierBizItem} disabled={!canEdit} onSave={(v) => patchDoc({ supplierBizItem: v })} />
          <Field label="전화번호" value={quote.supplierPhone} disabled={!canEdit} onSave={(v) => patchDoc({ supplierPhone: v })} />
          <Field label="이메일" value={quote.supplierEmail} disabled={!canEdit} onSave={(v) => patchDoc({ supplierEmail: v })} />
        </div>

        <div className="rounded-md border bg-secondary/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">제안금액 (VAT 포함)</span>
          <p className="text-xl font-bold tabular-nums">{formatMoney(totals.proposal)}원</p>
          {totals.trimmed > 0 && (
            <p className="text-[11px] text-muted-foreground">
              총계 {formatMoney(totals.grandTotal)}원 · 절사 −{formatMoney(totals.trimmed)}원
            </p>
          )}
        </div>

        {/* ── 세부내역 ────────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="w-6" />
                <th className="w-24 py-1 font-medium">항 목</th>
                <th className="py-1 pr-2 font-medium">세부내역</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">수량</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">횟수</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">일수</th>
                <th className="w-28 py-1 pr-2 text-right font-medium">단가</th>
                <th className="w-32 py-1 pr-2 text-right font-medium">금액</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {ordered.map((item) => {
                const amount = totals.amounts[item.id] ?? 0;
                const sectionEnd = lastOfSection.get(item.id);
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    amount={amount}
                    canEdit={canEdit}
                    pending={pending}
                    dragging={dragId === item.id}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => setDragId(null)}
                    onDrop={() => onDrop(item.id)}
                    onPatch={(p) => patchItem(item.id, p)}
                    onAddAfter={() => run(() => addQuoteItem(quote.id, item.id))}
                    onDelete={() => {
                      if (window.confirm(`'${item.name || "(이름 없음)"}' 항목을 지울까요?`))
                        run(() => deleteQuoteItem(item.id));
                    }}
                    sectionEnd={sectionEnd ? { ...sectionEnd, mark: SECTION_MARKS[sectionEnd.index] ?? "" } : null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => addQuoteItem(quote.id, null))}>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> 항목 추가
          </Button>
        )}

        {/* ── 합계 ────────────────────────────────────────────────────── */}
        <div className="ml-auto w-full max-w-md space-y-1 rounded-md border p-3 text-xs">
          <SumRow label="소계 합" value={totals.directTotal} />
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              간접비 (
              <EditableText
                value={quote.indirectLabel}
                disabled={!canEdit}
                onSave={(v) => patchDoc({ indirectLabel: v ?? "" })}
                inputClassName="w-20"
              />
              )
              <PercentInput
                value={quote.indirectRate}
                disabled={!canEdit}
                ariaLabel="간접비율"
                onCommit={(v) => patchDoc({ indirectRate: v })}
              />
            </span>
            <span className="tabular-nums">{formatMoney(totals.indirect)}</span>
          </div>
          <SumRow label="합계 (소계 + 간접비)" value={totals.totalWithIndirect} strong />
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              <EditableText
                value={quote.profitLabel}
                disabled={!canEdit}
                onSave={(v) => patchDoc({ profitLabel: v ?? "" })}
                inputClassName="w-20"
              />
              <PercentInput
                value={quote.profitRate}
                disabled={!canEdit}
                ariaLabel="기업이윤율"
                onCommit={(v) => patchDoc({ profitRate: v })}
              />
            </span>
            <span className="tabular-nums">{formatMoney(totals.profit)}</span>
          </div>
          <SumRow label="합계 (+ 기업이윤)" value={totals.totalWithProfit} strong />
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              부가세
              <PercentInput
                value={quote.vatRate}
                disabled={!canEdit}
                ariaLabel="부가세율"
                onCommit={(v) => patchDoc({ vatRate: v })}
              />
            </span>
            <span className="tabular-nums">{formatMoney(totals.vat)}</span>
          </div>
          <SumRow label="총 계" value={totals.grandTotal} strong />
          <div className="flex items-center justify-between gap-2 border-t pt-1">
            <label className="flex items-center gap-1 text-muted-foreground">
              최종 제안가
              <select
                value={quote.rounding}
                disabled={!canEdit}
                aria-label="제안가 절사"
                onChange={(e) => patchDoc({ rounding: e.target.value as RoundingMode })}
                className="rounded border border-input bg-white px-1 py-0.5 text-[11px]"
              >
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm font-bold tabular-nums">{formatMoney(totals.proposal)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SumRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", strong && "font-semibold")}>
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

function Field({
  label,
  value,
  disabled,
  onSave,
  multiline,
  placeholder,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (next: string | null) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-24 shrink-0 pt-0.5 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">
        <EditableText
          value={value}
          disabled={disabled}
          multiline={multiline}
          placeholder={placeholder}
          onSave={onSave}
        />
      </span>
    </div>
  );
}

function ItemRow({
  item,
  amount,
  canEdit,
  pending,
  dragging,
  sectionEnd,
  onDragStart,
  onDragEnd,
  onDrop,
  onPatch,
  onAddAfter,
  onDelete,
}: {
  item: QuoteItemView;
  amount: number;
  canEdit: boolean;
  pending: boolean;
  dragging: boolean;
  sectionEnd: { name: string | null; subtotal: number; mark: string } | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onPatch: (patch: QuoteItemPatch) => void;
  onAddAfter: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
        className={cn("align-top", dragging && "opacity-50")}
      >
        <td
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className={cn("py-1 text-muted-foreground", canEdit && "cursor-grab")}
          title={canEdit ? "끌어서 순서 변경" : undefined}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </td>
        <td className="py-0.5 pr-2">
          <EditableText value={item.section} disabled={!canEdit} placeholder="항목" onSave={(v) => onPatch({ section: v })} />
        </td>
        <td className="py-0.5 pr-2">
          <EditableText value={item.name} disabled={!canEdit} placeholder="세부내역" onSave={(v) => onPatch({ name: v ?? "" })} />
        </td>
        <NumCell value={item.qty} unit={item.qtyUnit} canEdit={canEdit} label={`${item.name} 수량`}
          onValue={(v) => onPatch({ qty: v })} onUnit={(v) => onPatch({ qtyUnit: v })} />
        <NumCell value={item.times} unit={item.timesUnit} canEdit={canEdit} label={`${item.name} 횟수`}
          onValue={(v) => onPatch({ times: v })} onUnit={(v) => onPatch({ timesUnit: v })} />
        <NumCell value={item.days} unit={item.daysUnit} canEdit={canEdit} label={`${item.name} 일수`}
          onValue={(v) => onPatch({ days: v })} onUnit={(v) => onPatch({ daysUnit: v })} />
        <td className="py-0.5 pr-2">
          <MoneyInput value={item.unitPrice} disabled={!canEdit} ariaLabel={`${item.name} 단가`} onCommit={(v) => onPatch({ unitPrice: v })} />
        </td>
        <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(amount)}</td>
        <td className="py-0.5 text-right">
          {canEdit && (
            <>
              <button type="button" title="아래에 항목 추가" className="rounded p-1 text-muted-foreground hover:text-brand" disabled={pending} onClick={onAddAfter}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" title="항목 삭제" className="rounded p-1 text-muted-foreground hover:text-red-600" disabled={pending} onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </td>
      </tr>
      {sectionEnd && (
        <tr className="bg-secondary/50 font-medium">
          <td />
          <td colSpan={6} className="py-1 pr-2">
            소계 ({sectionEnd.mark}) {sectionEnd.name ? `— ${sectionEnd.name}` : ""}
          </td>
          <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(sectionEnd.subtotal)}</td>
          <td />
        </tr>
      )}
    </>
  );
}

function NumCell({
  value,
  unit,
  canEdit,
  label,
  onValue,
  onUnit,
}: {
  value: number;
  unit: string | null;
  canEdit: boolean;
  label: string;
  onValue: (next: number) => void;
  onUnit: (next: string | null) => void;
}) {
  return (
    <td className="py-0.5 pr-2">
      <div className="flex items-center gap-0.5">
        <MoneyInput value={value} disabled={!canEdit} ariaLabel={label} onCommit={onValue} />
        <span className="w-8 shrink-0">
          <EditableText value={unit} disabled={!canEdit} placeholder="단위" onSave={onUnit} />
        </span>
      </div>
    </td>
  );
}
