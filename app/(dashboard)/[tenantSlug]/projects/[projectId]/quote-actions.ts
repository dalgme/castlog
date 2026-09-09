"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { explainActionError } from "@/lib/ux/action-errors";
import { ROUNDING_MODES } from "@/lib/quotes/calc";
import {
  logQuote,
  requireQuotesModule,
  QUOTE_LOG_ACTION_LABELS,
  type QuoteLogRow,
  type QuoteDocType,
} from "@/lib/quotes/server";

/**
 * 프로젝트 견적서 (기획 지시 2026-09-09 — 01).
 *
 * 발행(확정)된 견적은 고치지 않는다. 고쳐야 하면 '새 버전'을 만들고 이전
 * 버전은 그대로 남는다 — 나간 견적이 조용히 바뀌면 안 된다. 모든 변경은
 * quote_logs에 남는다.
 */

export type QuoteResult = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();
const SAVE_FAIL = "저장에 실패했습니다.";

/** 원인 분류를 문구에 담는다 (CLAUDE.md §12-9) */
async function saveError(message: string, fallback = SAVE_FAIL): Promise<{ ok: false; error: string }> {
  return { ok: false, error: await explainActionError(message, fallback) };
}
const LOCKED =
  "발행된 견적서는 고칠 수 없습니다 (규칙). '새 버전 작성'을 누르면 이 내용을 복사한 다음 버전이 만들어지고, 발행본은 그대로 보관됩니다.";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식(yyyy-mm-dd)을 확인하세요.")
  .refine((v) => {
    const y = Number(v.slice(0, 4));
    return y >= 2000 && y <= 2100 && !Number.isNaN(Date.parse(v));
  }, "날짜는 2000~2100년 사이여야 합니다.");

const amount = z.number().finite().min(-1e12).max(1e12);
const rate = z.number().finite().min(0).max(1);

function revalidate() {
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
}

/** 견적서와 그 프로젝트 — 권한·모듈·잠금 상태를 한 번에 판정한다 */
async function openQuote(quoteId: string, opts: { forEdit: boolean }) {
  if (!uuid.safeParse(quoteId).success) {
    return { ok: false as const, error: "대상을 확인할 수 없습니다." };
  }
  const supabase = createClient();
  const { data: quote } = await supabase
    .from("project_quotes")
    .select("id, project_id, version, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote) return { ok: false as const, error: "견적서를 찾을 수 없습니다." };
  const gate = await requireQuotesModule(quote.project_id);
  if (!gate.ok) return gate;
  if (opts.forEdit && quote.status !== "draft") return { ok: false as const, error: LOCKED };
  return { ok: true as const, actor: gate.actor, quote, supabase };
}

// ── 문서 ────────────────────────────────────────────────────────────────────

const DEFAULT_SECTIONS = ["기획비", "인건비", "운영비", "행사재료비"];

/** 견적서 만들기 — 상단은 프로젝트·회사 정보로 자동 채운다 (기획 지시 09) */
export async function createQuote(
  projectId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireQuotesModule(projectId);
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("name, client_name, starts_on, ends_on")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, business_registration_number, representative_name, address, contact_phone, industry")
    .eq("id", gate.actor.tenantId)
    .maybeSingle();

  // 두 사람이 각자 탭에서 누르면 빈 초안이 둘 생긴다 — 서버에서 막는다 (리뷰 M2)
  const { data: openDraft } = await supabase
    .from("project_quotes")
    .select("id, version")
    .eq("project_id", projectId)
    .eq("status", "draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openDraft) {
    return {
      ok: false,
      error: `작성 중인 견적서(v${openDraft.version})가 이미 있습니다 (상태 미충족). 그 초안을 발행하거나 지운 뒤 새로 만드세요.`,
    };
  }

  const { data: last } = await supabase
    .from("project_quotes")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const period =
    project.starts_on && project.ends_on
      ? `${project.starts_on} ~ ${project.ends_on}`
      : (project.starts_on ?? project.ends_on ?? null);

  const { data: created, error } = await supabase
    .from("project_quotes")
    .insert({
      tenant_id: gate.actor.tenantId,
      project_id: projectId,
      version,
      status: "draft",
      title: project.name,
      period_text: period,
      quote_date: new Date().toISOString().slice(0, 10),
      valid_text: "발행일로부터 3주",
      client_name: project.client_name,
      supplier_name: tenant?.name ?? null,
      supplier_reg_no: tenant?.business_registration_number ?? null,
      supplier_ceo: tenant?.representative_name ?? null,
      supplier_address: tenant?.address ?? null,
      supplier_biz_type: tenant?.industry ?? null,
      supplier_phone: tenant?.contact_phone ?? null,
      created_by: gate.actor.userId,
      updated_by: gate.actor.userId,
    })
    .select("id")
    .single();
  if (error || !created) return saveError(error?.message ?? "");

  // 빈 표는 무엇을 적어야 하는지 알려주지 않는다 — 표준 항목 묶음을 한 줄씩 깔아 둔다
  await supabase.from("project_quote_items").insert(
    DEFAULT_SECTIONS.map((section, i) => ({
      tenant_id: gate.actor.tenantId,
      quote_id: created.id,
      sort_order: (i + 1) * 10,
      section,
      name: "",
      qty_unit: "명",
      times_unit: "회",
      days_unit: "일",
    }))
  );

  await logQuote(gate.actor, {
    docType: "quote", docId: created.id, projectId, version,
    action: "doc.create", after: `v${version}`,
  });
  revalidate();
  return { ok: true, id: created.id };
}

const quotePatchSchema = z.object({
  title: z.string().max(200).optional(),
  headcount: z.string().max(60).nullable().optional(),
  periodText: z.string().max(120).nullable().optional(),
  quoteDate: isoDate.nullable().optional(),
  validText: z.string().max(120).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  supplierName: z.string().max(200).nullable().optional(),
  supplierRegNo: z.string().max(60).nullable().optional(),
  supplierCeo: z.string().max(60).nullable().optional(),
  supplierAddress: z.string().max(400).nullable().optional(),
  supplierBizType: z.string().max(200).nullable().optional(),
  supplierBizItem: z.string().max(200).nullable().optional(),
  supplierPhone: z.string().max(60).nullable().optional(),
  supplierEmail: z.string().max(200).nullable().optional(),
  indirectLabel: z.string().max(60).optional(),
  indirectRate: rate.optional(),
  profitLabel: z.string().max(60).optional(),
  profitRate: rate.optional(),
  vatRate: rate.optional(),
  rounding: z.enum(ROUNDING_MODES).optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type QuotePatch = z.infer<typeof quotePatchSchema>;

const QUOTE_COLUMNS: Record<keyof QuotePatch, string> = {
  title: "title", headcount: "headcount", periodText: "period_text", quoteDate: "quote_date",
  validText: "valid_text", clientName: "client_name", supplierName: "supplier_name",
  supplierRegNo: "supplier_reg_no", supplierCeo: "supplier_ceo", supplierAddress: "supplier_address",
  supplierBizType: "supplier_biz_type", supplierBizItem: "supplier_biz_item",
  supplierPhone: "supplier_phone", supplierEmail: "supplier_email",
  indirectLabel: "indirect_label", indirectRate: "indirect_rate", profitLabel: "profit_label",
  profitRate: "profit_rate", vatRate: "vat_rate", rounding: "rounding", note: "note",
};
const QUOTE_LABELS: Record<keyof QuotePatch, string> = {
  title: "사업명", headcount: "기준인원", periodText: "기간", quoteDate: "견적일",
  validText: "견적유효기간", clientName: "견적 대상", supplierName: "상호",
  supplierRegNo: "등록번호", supplierCeo: "대표이사", supplierAddress: "사업자주소",
  supplierBizType: "업태", supplierBizItem: "종목", supplierPhone: "전화번호",
  supplierEmail: "이메일", indirectLabel: "간접비 이름", indirectRate: "간접비율",
  profitLabel: "기업이윤 이름", profitRate: "기업이윤율", vatRate: "부가세율",
  rounding: "제안가 절사", note: "비고",
};

export async function updateQuote(quoteId: string, patch: QuotePatch): Promise<QuoteResult> {
  const parsed = quotePatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const open = await openQuote(quoteId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;

  const { data: before } = await supabase
    .from("project_quotes")
    .select("*")
    .eq("id", quoteId)
    .maybeSingle();
  if (!before) return { ok: false, error: "견적서를 찾을 수 없습니다." };

  const update: TablesUpdate<"project_quotes"> = { updated_by: actor.userId };
  const changes: { field: keyof QuotePatch; before: string | null; after: string | null }[] = [];
  for (const key of Object.keys(parsed.data) as (keyof QuotePatch)[]) {
    const raw = parsed.data[key];
    if (raw === undefined) continue;
    const next = typeof raw === "string" ? raw.trim() || null : raw;
    const col = QUOTE_COLUMNS[key];
    const prev = (before as Record<string, unknown>)[col];
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | null>)[col] = next as string | number | null;
    changes.push({
      field: key,
      before: prev === null || prev === undefined ? null : String(prev),
      after: next === null ? null : String(next),
    });
  }
  if (changes.length === 0) return { ok: true };
  if (update.title === null) return { ok: false, error: "사업명을 입력하세요." };

  const { error } = await supabase.from("project_quotes").update(update).eq("id", quoteId);
  if (error) return saveError(error.message);
  for (const c of changes) {
    await logQuote(actor, {
      docType: "quote", docId: quoteId, projectId: quote.project_id, version: quote.version,
      action: "doc.update", field: QUOTE_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

/** 발행 — 이 버전을 확정한다. 이후 수정은 새 버전으로만 */
export async function issueQuote(quoteId: string): Promise<QuoteResult> {
  const open = await openQuote(quoteId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;
  const { count } = await supabase
    .from("project_quote_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  if ((count ?? 0) === 0) {
    return { ok: false, error: "세부내역이 한 줄도 없습니다 (상태 미충족). 항목을 먼저 입력하세요." };
  }
  const { error } = await supabase
    .from("project_quotes")
    .update({
      status: "issued",
      issued_at: new Date().toISOString(),
      issued_by: actor.userId,
      updated_by: actor.userId,
    })
    .eq("id", quoteId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: "quote", docId: quoteId, projectId: quote.project_id, version: quote.version,
    action: "doc.issue", after: `v${quote.version}`,
  });
  revalidate();
  return { ok: true };
}

/** 새 버전 — 현재 내용을 복사한 초안을 만들고 이전 버전은 그대로 보관한다 */
export async function newQuoteVersion(
  quoteId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const open = await openQuote(quoteId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;

  const { data: src } = await supabase.from("project_quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!src) return { ok: false, error: "견적서를 찾을 수 없습니다." };

  const { data: openDraft } = await supabase
    .from("project_quotes")
    .select("id, version")
    .eq("project_id", quote.project_id)
    .eq("status", "draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openDraft) {
    return {
      ok: false,
      error: `작성 중인 견적서(v${openDraft.version})가 이미 있습니다 (상태 미충족). 그 초안을 발행하거나 지운 뒤 새 버전을 만드세요.`,
    };
  }

  const { data: last } = await supabase
    .from("project_quotes")
    .select("version")
    .eq("project_id", quote.project_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? quote.version) + 1;

  const { data: created, error } = await supabase
    .from("project_quotes")
    .insert({
      tenant_id: actor.tenantId,
      project_id: quote.project_id,
      version,
      status: "draft",
      title: src.title,
      headcount: src.headcount,
      period_text: src.period_text,
      quote_date: new Date().toISOString().slice(0, 10),
      valid_text: src.valid_text,
      client_name: src.client_name,
      supplier_name: src.supplier_name,
      supplier_reg_no: src.supplier_reg_no,
      supplier_ceo: src.supplier_ceo,
      supplier_address: src.supplier_address,
      supplier_biz_type: src.supplier_biz_type,
      supplier_biz_item: src.supplier_biz_item,
      supplier_phone: src.supplier_phone,
      supplier_email: src.supplier_email,
      indirect_label: src.indirect_label,
      indirect_rate: src.indirect_rate,
      profit_label: src.profit_label,
      profit_rate: src.profit_rate,
      vat_rate: src.vat_rate,
      rounding: src.rounding,
      note: src.note,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select("id")
    .single();
  if (error || !created) return saveError(error?.message ?? "");

  const { data: items } = await supabase
    .from("project_quote_items")
    .select("sort_order, section, name, qty, qty_unit, times, times_unit, days, days_unit, unit_price, note")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true });
  if (items && items.length > 0) {
    await supabase.from("project_quote_items").insert(
      items.map((it) => ({ ...it, tenant_id: actor.tenantId, quote_id: created.id }))
    );
  }

  await logQuote(actor, {
    docType: "quote", docId: created.id, projectId: quote.project_id, version,
    action: "doc.new_version", before: `v${quote.version}`, after: `v${version}`,
  });
  revalidate();
  return { ok: true, id: created.id };
}

/** 초안 삭제 — 발행본은 지우지 않는다 (CLAUDE.md §14-4 삭제보다 비활성화) */
export async function deleteQuote(quoteId: string): Promise<QuoteResult> {
  const open = await openQuote(quoteId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;
  if (quote.status !== "draft") {
    return {
      ok: false,
      error: "발행된 견적서는 지울 수 없습니다 (규칙). 기록으로 남겨 두고 새 버전을 쓰세요.",
    };
  }
  const { count } = await supabase
    .from("project_cost_sheets")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "이 견적서에 연결된 내부실견적서가 있습니다 (상태 미충족). 그 문서를 먼저 정리하세요.",
    };
  }
  const { error } = await supabase.from("project_quotes").delete().eq("id", quoteId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: "quote", docId: quoteId, projectId: quote.project_id, version: quote.version,
    action: "doc.delete", before: `v${quote.version}`,
  });
  revalidate();
  return { ok: true };
}

// ── 항목 ────────────────────────────────────────────────────────────────────

const itemPatchSchema = z.object({
  section: z.string().max(40).nullable().optional(),
  name: z.string().max(200).optional(),
  qty: amount.optional(),
  qtyUnit: z.string().max(10).nullable().optional(),
  times: amount.optional(),
  timesUnit: z.string().max(10).nullable().optional(),
  days: amount.optional(),
  daysUnit: z.string().max(10).nullable().optional(),
  unitPrice: amount.optional(),
  note: z.string().max(500).nullable().optional(),
});
export type QuoteItemPatch = z.infer<typeof itemPatchSchema>;

const ITEM_COLUMNS: Record<keyof QuoteItemPatch, string> = {
  section: "section", name: "name", qty: "qty", qtyUnit: "qty_unit", times: "times",
  timesUnit: "times_unit", days: "days", daysUnit: "days_unit", unitPrice: "unit_price", note: "note",
};
const ITEM_LABELS: Record<keyof QuoteItemPatch, string> = {
  section: "항목", name: "세부내역", qty: "수량", qtyUnit: "수량 단위", times: "횟수",
  timesUnit: "횟수 단위", days: "일수", daysUnit: "일수 단위", unitPrice: "단가", note: "비고",
};

export async function addQuoteItem(
  quoteId: string,
  afterItemId: string | null,
  seed?: { section?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const open = await openQuote(quoteId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;

  const { data: rows } = await supabase
    .from("project_quote_items")
    .select("id, sort_order, section, qty_unit, times_unit, days_unit")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true });
  const list = rows ?? [];
  if (list.length >= 300) {
    return { ok: false, error: "한 견적서에는 항목을 300개까지 넣을 수 있습니다 (상태 미충족)." };
  }
  const idx = afterItemId ? list.findIndex((r) => r.id === afterItemId) : -1;
  const prev = idx >= 0 ? list[idx] : null;
  let sortOrder: number;
  if (!prev) {
    sortOrder = (list[list.length - 1]?.sort_order ?? 0) + 10;
  } else {
    const next = list[idx + 1]?.sort_order;
    if (next === undefined) sortOrder = prev.sort_order + 10;
    else if (next - prev.sort_order > 1) sortOrder = Math.floor((prev.sort_order + next) / 2);
    else {
      // 틈이 없다 — 전체를 다시 번호 매기고 그 사이에 넣는다
      for (let i = 0; i < list.length; i += 1) {
        await supabase
          .from("project_quote_items")
          .update({ sort_order: (i + 1) * 10 })
          .eq("id", list[i]!.id);
      }
      sortOrder = (idx + 1) * 10 + 5;
    }
  }

  const { data, error } = await supabase
    .from("project_quote_items")
    .insert({
      tenant_id: actor.tenantId,
      quote_id: quoteId,
      sort_order: sortOrder,
      section: seed?.section ?? prev?.section ?? null,
      name: "",
      qty_unit: prev?.qty_unit ?? "명",
      times_unit: prev?.times_unit ?? "회",
      days_unit: prev?.days_unit ?? "일",
    })
    .select("id")
    .single();
  if (error || !data) return saveError(error?.message ?? "");
  await logQuote(actor, {
    docType: "quote", docId: quoteId, projectId: quote.project_id, version: quote.version,
    action: "item.add", itemTitle: seed?.section ?? prev?.section ?? "새 항목",
  });
  revalidate();
  return { ok: true, id: data.id };
}

export async function updateQuoteItem(
  itemId: string,
  patch: QuoteItemPatch
): Promise<QuoteResult> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const parsed = itemPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_quote_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const open = await openQuote(before.quote_id, { forEdit: true });
  if (!open.ok) return open;
  const { actor, quote } = open;

  const update: TablesUpdate<"project_quote_items"> = {};
  const changes: { field: keyof QuoteItemPatch; before: string | null; after: string | null }[] = [];
  for (const key of Object.keys(parsed.data) as (keyof QuoteItemPatch)[]) {
    const raw = parsed.data[key];
    if (raw === undefined) continue;
    const next = typeof raw === "string" ? raw.trim() || null : raw;
    const col = ITEM_COLUMNS[key];
    const prev = (before as Record<string, unknown>)[col];
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | null>)[col] = next as string | number | null;
    changes.push({
      field: key,
      before: prev === null || prev === undefined ? null : String(prev),
      after: next === null ? null : String(next),
    });
  }
  if (changes.length === 0) return { ok: true };
  if (update.name === null) update.name = "";

  const { error } = await supabase.from("project_quote_items").update(update).eq("id", itemId);
  if (error) return saveError(error.message);
  for (const c of changes) {
    await logQuote(actor, {
      docType: "quote", docId: before.quote_id, projectId: quote.project_id, version: quote.version,
      action: "item.update", itemTitle: before.name || before.section,
      field: ITEM_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

export async function deleteQuoteItem(itemId: string): Promise<QuoteResult> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_quote_items")
    .select("id, quote_id, name, section")
    .eq("id", itemId)
    .maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const open = await openQuote(before.quote_id, { forEdit: true });
  if (!open.ok) return open;
  const { actor, quote } = open;
  const { error } = await supabase.from("project_quote_items").delete().eq("id", itemId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: "quote", docId: before.quote_id, projectId: quote.project_id, version: quote.version,
    action: "item.delete", itemTitle: before.name || before.section, before: before.name,
  });
  revalidate();
  return { ok: true };
}

export async function reorderQuoteItems(
  quoteId: string,
  orderedIds: string[]
): Promise<QuoteResult> {
  if (!z.array(uuid).max(300).safeParse(orderedIds).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다." };
  }
  const open = await openQuote(quoteId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, quote } = open;
  const { data: rows } = await supabase
    .from("project_quote_items")
    .select("id")
    .eq("quote_id", quoteId);
  const own = new Set((rows ?? []).map((r) => r.id));
  const ids = orderedIds.filter((id) => own.has(id));
  if (ids.length === 0) return { ok: true };
  for (let i = 0; i < ids.length; i += 1) {
    await supabase
      .from("project_quote_items")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", ids[i]!)
      .eq("quote_id", quoteId);
  }
  await logQuote(actor, {
    docType: "quote", docId: quoteId, projectId: quote.project_id, version: quote.version,
    action: "item.reorder", after: `${ids.length}개 항목 순서 변경`,
  });
  revalidate();
  return { ok: true };
}

// ── 로그 ────────────────────────────────────────────────────────────────────

export async function getQuoteLogs(
  projectId: string,
  docType?: QuoteDocType
): Promise<{ ok: true; rows: QuoteLogRow[] } | { ok: false; error: string }> {
  const gate = await requireQuotesModule(projectId);
  if (!gate.ok) return gate;
  const supabase = createClient();
  let query = supabase
    .from("quote_logs")
    .select("id, created_at, actor_name, doc_type, version, action, item_title, field, before_value, after_value")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (docType) query = query.eq("doc_type", docType);
  const { data } = await query;
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      at: r.created_at,
      actorName: r.actor_name,
      docType: r.doc_type as QuoteDocType,
      version: r.version,
      action: QUOTE_LOG_ACTION_LABELS[r.action] ?? r.action,
      itemTitle: r.item_title,
      field: r.field,
      before: r.before_value,
      after: r.after_value,
    })),
  };
}
