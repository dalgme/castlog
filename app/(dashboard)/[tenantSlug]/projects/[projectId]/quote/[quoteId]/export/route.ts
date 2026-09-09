import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse, type SheetRows } from "@/lib/exports/xlsx";
import { getTenantModules } from "@/lib/modules/server";
import { buildQuoteTotals } from "@/lib/quotes/calc";
import { loadQuote } from "@/lib/quotes/load";

/**
 * 견적서 엑셀 내보내기 (기획 지시 2026-09-09 — 01).
 * 화면과 같은 계산기(lib/quotes/calc)를 쓴다 — 파일과 화면의 금액이 어긋나면
 * 그 견적서는 못 쓴다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string; projectId: string; quoteId: string } }
) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  const back = new URL(`/${params.tenantSlug}/projects/${params.projectId}?tab=quote`, request.url);
  if (!hasSupabaseEnv()) return NextResponse.redirect(back);

  const modules = await getTenantModules();
  if (!modules.quotes) return NextResponse.redirect(back);

  // RLS 안에서만 읽힌다 — 열람 범위 밖이면 null
  const quote = await loadQuote(params.quoteId);
  if (!quote || quote.projectId !== params.projectId) return NextResponse.redirect(back);

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

  const blank = { 수량: null, 단위: null, 횟수: null, "횟수 단위": null, 일수: null, "일수 단위": null, 단가: null };
  const rows: SheetRows = [];
  for (const item of quote.items) {
    rows.push({
      "항 목": item.section ?? "",
      세부내역: item.name,
      수량: item.qty,
      단위: item.qtyUnit ?? "",
      횟수: item.times,
      "횟수 단위": item.timesUnit ?? "",
      일수: item.days,
      "일수 단위": item.daysUnit ?? "",
      단가: item.unitPrice,
      금액: totals.amounts[item.id] ?? 0,
    });
    const end = lastOfSection.get(item.id);
    if (end) {
      rows.push({
        "항 목": "",
        세부내역: `소계 (${MARKS[end.index] ?? ""})${end.name ? ` — ${end.name}` : ""}`,
        ...blank,
        금액: end.subtotal,
      });
    }
  }
  const summary: [string, number][] = [
    ["소계 합", totals.directTotal],
    [`간접비 (${quote.indirectLabel}, ${(quote.indirectRate * 100).toFixed(1)}%)`, totals.indirect],
    ["합계 (소계 + 간접비)", totals.totalWithIndirect],
    [`${quote.profitLabel} (${(quote.profitRate * 100).toFixed(1)}%)`, totals.profit],
    ["합계 (+ 기업이윤)", totals.totalWithProfit],
    [`부가세 (${(quote.vatRate * 100).toFixed(1)}%)`, totals.vat],
    ["총 계", totals.grandTotal],
    ["제안금액 (절사 후)", totals.proposal],
  ];
  for (const [label, value] of summary) {
    rows.push({ "항 목": "", 세부내역: label, ...blank, 금액: value });
  }

  const header: SheetRows = [
    { 항목: "사업명", 내용: quote.title },
    { 항목: "기준인원", 내용: quote.headcount ?? "" },
    { 항목: "기간", 내용: quote.periodText ?? "" },
    { 항목: "견적일", 내용: quote.quoteDate ?? "" },
    { 항목: "견적유효기간", 내용: quote.validText ?? "" },
    { 항목: "견적 대상", 내용: quote.clientName ?? "" },
    { 항목: "상호", 내용: quote.supplierName ?? "" },
    { 항목: "등록번호", 내용: quote.supplierRegNo ?? "" },
    { 항목: "대표이사", 내용: quote.supplierCeo ?? "" },
    { 항목: "사업자주소", 내용: quote.supplierAddress ?? "" },
    { 항목: "업태", 내용: quote.supplierBizType ?? "" },
    { 항목: "종목", 내용: quote.supplierBizItem ?? "" },
    { 항목: "전화번호", 내용: quote.supplierPhone ?? "" },
    { 항목: "이메일", 내용: quote.supplierEmail ?? "" },
    { 항목: "버전", 내용: `v${quote.version}${quote.status === "issued" ? " (발행)" : " (작성 중)"}` },
  ];

  return xlsxResponse(`견적서_${quote.title}_v${quote.version}`, [
    ["견적서", header],
    ["세부내역", rows],
  ]);
}
