import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isRoundingMode, type RoundingMode } from "./calc";

/**
 * 프로젝트 견적서 조회 (RLS: 프로젝트 열람 범위). 탭 화면·엑셀·인쇄가 같은
 * 로더를 써서 어디서 보든 같은 숫자가 나오게 한다.
 */

export type LoadedQuoteItem = {
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

export type LoadedQuote = {
  id: string;
  projectId: string;
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
  items: LoadedQuoteItem[];
};

const QUOTE_COLUMNS =
  "id, project_id, version, status, title, headcount, period_text, quote_date, valid_text, client_name, " +
  "supplier_name, supplier_reg_no, supplier_ceo, supplier_address, supplier_biz_type, supplier_biz_item, " +
  "supplier_phone, supplier_email, indirect_label, indirect_rate, profit_label, profit_rate, vat_rate, " +
  "rounding, note, issued_at, issued_by, updated_at";

type QuoteRow = {
  id: string; project_id: string; version: number; status: string; title: string;
  headcount: string | null; period_text: string | null; quote_date: string | null;
  valid_text: string | null; client_name: string | null; supplier_name: string | null;
  supplier_reg_no: string | null; supplier_ceo: string | null; supplier_address: string | null;
  supplier_biz_type: string | null; supplier_biz_item: string | null; supplier_phone: string | null;
  supplier_email: string | null; indirect_label: string; indirect_rate: number;
  profit_label: string; profit_rate: number; vat_rate: number; rounding: string;
  note: string | null; issued_at: string | null; issued_by: string | null; updated_at: string;
};

function toQuote(row: QuoteRow, items: LoadedQuoteItem[], issuerName: string | null): LoadedQuote {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status === "issued" ? "issued" : "draft",
    title: row.title,
    headcount: row.headcount,
    periodText: row.period_text,
    quoteDate: row.quote_date,
    validText: row.valid_text,
    clientName: row.client_name,
    supplierName: row.supplier_name,
    supplierRegNo: row.supplier_reg_no,
    supplierCeo: row.supplier_ceo,
    supplierAddress: row.supplier_address,
    supplierBizType: row.supplier_biz_type,
    supplierBizItem: row.supplier_biz_item,
    supplierPhone: row.supplier_phone,
    supplierEmail: row.supplier_email,
    indirectLabel: row.indirect_label,
    indirectRate: Number(row.indirect_rate),
    profitLabel: row.profit_label,
    profitRate: Number(row.profit_rate),
    vatRate: Number(row.vat_rate),
    rounding: isRoundingMode(row.rounding) ? row.rounding : "none",
    note: row.note,
    issuedAt: row.issued_at,
    issuedByName: issuerName,
    updatedAt: row.updated_at,
    items,
  };
}

async function loadItems(quoteIds: string[]): Promise<Map<string, LoadedQuoteItem[]>> {
  const byQuote = new Map<string, LoadedQuoteItem[]>();
  if (quoteIds.length === 0) return byQuote;
  const supabase = createClient();
  const { data } = await supabase
    .from("project_quote_items")
    .select("id, quote_id, section, name, qty, qty_unit, times, times_unit, days, days_unit, unit_price")
    .in("quote_id", quoteIds)
    .order("sort_order", { ascending: true });
  for (const it of data ?? []) {
    const list = byQuote.get(it.quote_id) ?? [];
    list.push({
      id: it.id,
      section: it.section,
      name: it.name,
      qty: Number(it.qty),
      qtyUnit: it.qty_unit,
      times: Number(it.times),
      timesUnit: it.times_unit,
      days: Number(it.days),
      daysUnit: it.days_unit,
      unitPrice: Number(it.unit_price),
    });
    byQuote.set(it.quote_id, list);
  }
  return byQuote;
}

async function issuerNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return new Map();
  const supabase = createClient();
  const { data } = await supabase.from("users").select("id, name").in("id", unique);
  return new Map((data ?? []).map((u) => [u.id, u.name]));
}

/** 최신 버전이 앞에 오도록 정렬해 전부 돌려준다 (버전 탭용) */
export async function loadProjectQuotes(
  projectId: string
): Promise<{ quotes: LoadedQuote[]; missingTable: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_quotes")
    .select(QUOTE_COLUMNS)
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    // 버전이 쌓여도 탭 진입이 무거워지지 않게 (리뷰 L4)
    .limit(20);
  if (error?.code === "42P01") return { quotes: [], missingTable: true };
  const rows = (data ?? []) as unknown as QuoteRow[];
  const [items, names] = await Promise.all([
    loadItems(rows.map((r) => r.id)),
    issuerNames(rows.map((r) => r.issued_by)),
  ]);
  return {
    quotes: rows.map((r) =>
      toQuote(r, items.get(r.id) ?? [], r.issued_by ? (names.get(r.issued_by) ?? null) : null)
    ),
    missingTable: false,
  };
}

export async function loadQuote(quoteId: string): Promise<LoadedQuote | null> {
  const supabase = createClient();
  const { data } = await supabase.from("project_quotes").select(QUOTE_COLUMNS).eq("id", quoteId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as QuoteRow;
  const [items, names] = await Promise.all([loadItems([row.id]), issuerNames([row.issued_by])]);
  return toQuote(row, items.get(row.id) ?? [], row.issued_by ? (names.get(row.issued_by) ?? null) : null);
}
