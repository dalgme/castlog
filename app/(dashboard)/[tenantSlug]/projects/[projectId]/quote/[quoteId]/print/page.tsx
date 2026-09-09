import { Fragment } from "react";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getTenantModules } from "@/lib/modules/server";
import { buildQuoteTotals, formatMoney } from "@/lib/quotes/calc";
import { loadQuote } from "@/lib/quotes/load";
import { EmptyState } from "@/components/layout/empty-state";

import { PrintButton } from "./print-button";

export const metadata = { title: "견적서" };

/**
 * 견적서 인쇄용 화면 (기획 지시 2026-09-09 — 01: 엑셀/PDF 저장).
 * 브라우저 인쇄에서 'PDF로 저장'을 고르면 그대로 PDF가 된다 — 화면·엑셀·PDF가
 * 같은 계산기(lib/quotes/calc)를 쓰므로 숫자가 어긋나지 않는다.
 */
export default async function QuotePrintPage({
  params,
}: {
  params: { tenantSlug: string; projectId: string; quoteId: string };
}) {
  await requireUser();
  if (!hasSupabaseEnv()) {
    return <EmptyState title="서버 설정 대기 중" description="Supabase 환경변수가 설정되면 표시됩니다." />;
  }
  const modules = await getTenantModules();
  if (!modules.quotes) notFound();

  const quote = await loadQuote(params.quoteId);
  if (!quote || quote.projectId !== params.projectId) notFound();

  const totals = buildQuoteTotals(
    quote.items.map((i) => ({
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
  const lastOfSection = new Map<string, { name: string | null; subtotal: number; index: number }>();
  totals.sections.forEach((s, i) => {
    const last = s.itemIds[s.itemIds.length - 1];
    if (last) lastOfSection.set(last, { name: s.name, subtotal: s.subtotal, index: i });
  });
  const MARKS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[11px] text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-xs text-muted-foreground">
          인쇄 창에서 ‘PDF로 저장’을 고르면 PDF 파일이 됩니다.
        </p>
        <PrintButton />
      </div>

      <h1 className="mb-4 border-b-2 border-black pb-2 text-center text-2xl font-bold tracking-[0.4em]">
        견 적 서
      </h1>

      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1">
        <Row label="사업명" value={quote.title} />
        <Row label="상호" value={quote.supplierName} />
        <Row label="기준인원" value={quote.headcount} />
        <Row label="등록번호" value={quote.supplierRegNo} />
        <Row label="기간" value={quote.periodText} />
        <Row label="대표이사" value={quote.supplierCeo} />
        <Row label="견적일" value={quote.quoteDate} />
        <Row label="사업자주소" value={quote.supplierAddress} />
        <Row label="견적유효기간" value={quote.validText} />
        <Row label="업태 / 종목" value={[quote.supplierBizType, quote.supplierBizItem].filter(Boolean).join(" / ")} />
        <Row label="견적 대상" value={quote.clientName} />
        <Row label="전화 / 이메일" value={[quote.supplierPhone, quote.supplierEmail].filter(Boolean).join(" / ")} />
      </div>

      <div className="mb-4 border-2 border-black px-3 py-2">
        <span className="text-xs">제안금액 (VAT 포함)</span>
        <p className="text-lg font-bold">일금 {formatMoney(totals.proposal)}원정</p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-neutral-100">
            <Th className="w-20">항 목</Th>
            <Th>세부내역</Th>
            <Th className="w-16 text-right">수량</Th>
            <Th className="w-16 text-right">횟수</Th>
            <Th className="w-16 text-right">일수</Th>
            <Th className="w-24 text-right">단가</Th>
            <Th className="w-28 text-right">금액</Th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item) => {
            const end = lastOfSection.get(item.id);
            return (
              <Fragment key={item.id}>
                <tr>
                  <Td>{item.section ?? ""}</Td>
                  <Td>{item.name}</Td>
                  <Td className="text-right">{`${formatMoney(item.qty)}${item.qtyUnit ?? ""}`}</Td>
                  <Td className="text-right">{`${formatMoney(item.times)}${item.timesUnit ?? ""}`}</Td>
                  <Td className="text-right">{`${formatMoney(item.days)}${item.daysUnit ?? ""}`}</Td>
                  <Td className="text-right">{formatMoney(item.unitPrice)}</Td>
                  <Td className="text-right">{formatMoney(totals.amounts[item.id] ?? 0)}</Td>
                </tr>
                {end && (
                  <tr className="bg-neutral-50 font-semibold">
                    <Td />
                    <Td colSpan={5}>
                      소계 ({MARKS[end.index] ?? ""}){end.name ? ` — ${end.name}` : ""}
                    </Td>
                    <Td className="text-right">{formatMoney(end.subtotal)}</Td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          <SumRow label={`간접비 (${quote.indirectLabel}, ${(quote.indirectRate * 100).toFixed(1)}%)`} value={totals.indirect} />
          <SumRow label="합 계 (소계 + 간접비)" value={totals.totalWithIndirect} strong />
          <SumRow label={`${quote.profitLabel} (${(quote.profitRate * 100).toFixed(1)}%)`} value={totals.profit} />
          <SumRow label="합 계 (+ 기업이윤)" value={totals.totalWithProfit} strong />
          <SumRow label={`부가세 (${(quote.vatRate * 100).toFixed(1)}%)`} value={totals.vat} />
          <SumRow label="총 계" value={totals.grandTotal} strong />
          <SumRow label="제안금액 (절사 후)" value={totals.proposal} strong />
        </tbody>
      </table>

      {quote.note && <p className="mt-3 whitespace-pre-wrap">{quote.note}</p>}
      <p className="mt-6 text-right text-[10px] text-neutral-500">
        v{quote.version}
        {quote.status === "issued" ? ` · 발행 ${quote.issuedAt?.slice(0, 10) ?? ""}` : " · 작성 중"}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2 border-b border-neutral-200 py-0.5">
      <span className="w-24 shrink-0 text-neutral-500">{label}</span>
      <span className="whitespace-pre-wrap font-medium">{value || "-"}</span>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`border border-neutral-400 px-1 py-1 font-medium ${className ?? ""}`}>{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-neutral-400 px-1 py-1 ${className ?? ""}`}>
      {children}
    </td>
  );
}

function SumRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? "bg-neutral-100 font-bold" : undefined}>
      <Td />
      <Td colSpan={5}>{label}</Td>
      <Td className="text-right">{formatMoney(value)}</Td>
    </tr>
  );
}
