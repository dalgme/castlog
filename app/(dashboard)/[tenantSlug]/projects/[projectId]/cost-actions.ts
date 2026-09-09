"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { gradeRank, isUserGrade } from "@/lib/auth/grades";
import { explainActionError } from "@/lib/ux/action-errors";
import { buildQuoteTotals } from "@/lib/quotes/calc";
import { loadQuote } from "@/lib/quotes/load";
import { logQuote, requireQuotesModule } from "@/lib/quotes/server";
import type { CostSheetKind } from "@/lib/quotes/cost-load";

/**
 * 내부실견적서 · 정산서 (기획 지시 2026-09-09 — 02·03).
 *
 * 왼쪽(견적/내부실견적)은 스냅샷이라 이 화면에서 고칠 수 없다. 오른쪽(지출·
 * 부가세 환급 대상·비고)만 기입한다. 상급자 결재를 받으면 확정되고, 고치려면
 * 상급자 본인이거나 상급자가 수정을 허용한 담당자가 새 버전을 만들어 재승인을
 * 받는다 — 확정본은 그대로 보관되고 모든 변경은 로그에 남는다.
 */

export type CostResult = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();
const amount = z.number().finite().min(-1e12).max(1e12);
const SAVE_FAIL = "저장에 실패했습니다.";

/** 원인 분류를 문구에 담는다 (CLAUDE.md §12-9) — RLS 거부를 시스템 오류로 뭉뚱그리지 않는다 */
async function saveError(message: string, fallback = SAVE_FAIL): Promise<{ ok: false; error: string }> {
  return { ok: false, error: await explainActionError(message, fallback) };
}

const KIND_LABEL: Record<CostSheetKind, string> = {
  internal: "내부실견적서",
  settlement: "정산서",
};

function revalidate() {
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
}

function lockedMessage(kind: CostSheetKind, status: string): string {
  if (status === "submitted") {
    return `${KIND_LABEL[kind]}가 결재 상신 중입니다 (상태 미충족). 상급자가 승인하거나 반려해야 다시 고칠 수 있습니다.`;
  }
  return `확정된 ${KIND_LABEL[kind]}는 고칠 수 없습니다 (규칙). '새 버전 작성'을 누르면 이 내용을 복사한 다음 버전이 만들어지고 재승인을 받습니다.`;
}

async function openSheet(sheetId: string, opts: { forEdit: boolean }) {
  if (!uuid.safeParse(sheetId).success) {
    return { ok: false as const, error: "대상을 확인할 수 없습니다." };
  }
  const supabase = createClient();
  const { data: sheet } = await supabase
    .from("project_cost_sheets")
    .select("id, project_id, kind, version, status, quote_id, source_sheet_id, created_by, submitted_by, approved_by, edit_grant_to")
    .eq("id", sheetId)
    .maybeSingle();
  if (!sheet) return { ok: false as const, error: "문서를 찾을 수 없습니다." };
  const gate = await requireQuotesModule(sheet.project_id);
  if (!gate.ok) return gate;
  const kind: CostSheetKind = sheet.kind === "settlement" ? "settlement" : "internal";
  if (opts.forEdit && sheet.status !== "draft") {
    return { ok: false as const, error: lockedMessage(kind, sheet.status) };
  }
  return { ok: true as const, actor: gate.actor, sheet, kind, supabase };
}

/**
 * 결재 자격 — 관련자(작성자·상신자) **전원**보다 높은 권한단계여야 한다.
 * 종전에는 상신자 한 사람만 봤다: 팀장이 쓴 문서를 사원이 대신 상신하면 그
 * 팀장이 자기 문서를 스스로 승인할 수 있었다 (리뷰 H2).
 */
async function isAbove(actorGrade: string | null, targetUserIds: (string | null)[]): Promise<boolean> {
  if (!isUserGrade(actorGrade)) return false;
  const ids = Array.from(new Set(targetUserIds.filter((v): v is string => Boolean(v))));
  if (ids.length === 0) return true;
  const supabase = createClient();
  const { data } = await supabase.from("users").select("id, grade").in("id", ids);
  const highest = (data ?? []).reduce(
    (max, u) => Math.max(max, gradeRank(isUserGrade(u.grade) ? u.grade : null)),
    0
  );
  return gradeRank(actorGrade) > highest;
}

// ── 문서 만들기 ─────────────────────────────────────────────────────────────

/** 견적 항목 → 원가시트 줄 (왼쪽 스냅샷) */
async function baseLinesFromQuote(quoteId: string) {
  const quote = await loadQuote(quoteId);
  if (!quote) return null;
  const totals = buildQuoteTotals(
    quote.items.map((i) => ({
      id: i.id, section: i.section, qty: i.qty, times: i.times, days: i.days, unitPrice: i.unitPrice,
    })),
    { indirectRate: quote.indirectRate, profitRate: quote.profitRate, vatRate: quote.vatRate, rounding: quote.rounding }
  );
  // 간접비·기업이윤도 계약금액의 일부다 — 줄로 깔지 않으면 그만큼 수익이
  // 통째로 빠진다(원본 엑셀 '내부용' 시트도 두 항목을 행으로 둔다, 리뷰 H4).
  return {
    quote,
    totals,
    lines: [
      ...quote.items.map((i) => ({
        baseSection: i.section,
        baseName: i.name,
        baseAmount: totals.amounts[i.id] ?? 0,
      })),
      { baseSection: "간접비", baseName: quote.indirectLabel, baseAmount: totals.indirect },
      { baseSection: "기업이윤", baseName: quote.profitLabel, baseAmount: totals.profit },
    ],
  };
}

/** 최신 견적서 — 발행본 우선 (리뷰 M3) */
async function latestQuote(projectId: string, opts: { issuedOnly: boolean }) {
  const supabase = createClient();
  let q = supabase
    .from("project_quotes")
    .select("id, version, status")
    .eq("project_id", projectId);
  if (opts.issuedOnly) q = q.eq("status", "issued");
  const { data } = await q.order("version", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** 왼쪽 줄을 값으로 잇는다 — 순서(인덱스)가 아니라 (항목, 세부내역) 짝으로 (리뷰 H3·M7) */
function keyOfLine(section: string | null, name: string | null): string {
  return `${(section ?? "").trim()}\u0001${(name ?? "").trim()}`;
}

/**
 * 내부실견적서·정산서 만들기.
 *  - internal   : 그 프로젝트의 최신 견적서에 연결한다.
 *  - settlement : 최신 확정 내부실견적서에 연결하고, 그 지출을 비교용으로 함께 싣는다.
 */
export async function createCostSheet(
  projectId: string,
  kind: CostSheetKind
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireQuotesModule(projectId);
  if (!gate.ok) return gate;
  if (kind !== "internal" && kind !== "settlement") {
    return { ok: false, error: "문서 종류를 확인하세요." };
  }
  const supabase = createClient();

  // 행이 2개 이상이면 maybeSingle이 error + data:null을 준다 — 그대로 두면
  // 중복 방지 가드가 오히려 통과한다(fail-open, 리뷰 M2)
  const { data: openDraft } = await supabase
    .from("project_cost_sheets")
    .select("id, version, status")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .neq("status", "confirmed")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openDraft) {
    return {
      ok: false,
      error: `작성 중인 ${KIND_LABEL[kind]}(v${openDraft.version})가 이미 있습니다 (상태 미충족). 그 문서를 확정하거나 정리한 뒤 만드세요.`,
    };
  }

  // 왼쪽 원본 고르기
  let quoteId: string | null = null;
  let sourceSheetId: string | null = null;
  let sourceVersion: number | null = null;
  const compare = new Map<string, { note: string | null; spend: number }>();
  const compareExtras: { note: string | null; spend: number }[] = [];

  if (kind === "internal") {
    // 발행본을 우선한다 — 작성 중인 빈 초안(단가 0)에 붙으면 제안금액이 0이 되어
    // 수익률이 '-'로 나온다 (리뷰 M3)
    const quote = await latestQuote(projectId, { issuedOnly: true }) ?? (await latestQuote(projectId, { issuedOnly: false }));
    if (!quote) {
      return { ok: false, error: "이 프로젝트에 견적서가 없습니다 (상태 미충족). 견적서를 먼저 만드세요." };
    }
    quoteId = quote.id;
    sourceVersion = quote.version;
  } else {
    const { data: internal } = await supabase
      .from("project_cost_sheets")
      .select("id, version, quote_id, status")
      .eq("project_id", projectId)
      .eq("kind", "internal")
      .eq("status", "confirmed")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!internal) {
      return {
        ok: false,
        error: "확정된 내부실견적서가 없습니다 (상태 미충족). 내부실견적서를 상급자 결재로 확정한 뒤 정산서를 만드세요.",
      };
    }
    sourceSheetId = internal.id;
    sourceVersion = internal.version;
    quoteId = internal.quote_id;
    const { data: srcLines } = await supabase
      .from("project_cost_lines")
      .select("base_section, base_name, note, spend, sort_order")
      .eq("sheet_id", internal.id)
      .order("sort_order", { ascending: true });
    for (const l of srcLines ?? []) {
      const entry = { note: l.note, spend: Number(l.spend) };
      // 견적에 없던 '추가 지출'은 짝지을 줄이 없다 — 비교 전용 줄로 뒤에 붙인다
      if (l.base_name === null) compareExtras.push(entry);
      else compare.set(keyOfLine(l.base_section, l.base_name), entry);
    }
  }

  if (!quoteId) {
    return { ok: false, error: "연결할 견적서를 찾을 수 없습니다 (상태 미충족)." };
  }
  const base = await baseLinesFromQuote(quoteId);
  if (!base) return { ok: false, error: "견적서를 읽을 수 없습니다." };

  const { data: last } = await supabase
    .from("project_cost_sheets")
    .select("version")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const { data: created, error } = await supabase
    .from("project_cost_sheets")
    .insert({
      tenant_id: gate.actor.tenantId,
      project_id: projectId,
      kind,
      version,
      status: "draft",
      quote_id: quoteId,
      source_sheet_id: sourceSheetId,
      source_version: sourceVersion,
      base_total: base.totals.grandTotal,
      base_vat: base.totals.vat,
      base_proposal: base.totals.proposal,
      base_trimmed: base.totals.trimmed,
      travel_note: "출장교통비",
      reserve_note: "사업담당자 예비비",
      created_by: gate.actor.userId,
      updated_by: gate.actor.userId,
    })
    .select("id")
    .single();
  if (error || !created) return saveError(error?.message ?? "", `${KIND_LABEL[kind]}를 만들지 못했습니다.`);

  const rows = [
    ...base.lines.map((l) => {
      const c = compare.get(keyOfLine(l.baseSection, l.baseName));
      return {
        base_section: l.baseSection,
        base_name: l.baseName,
        base_amount: l.baseAmount,
        compare_note: c?.note ?? null,
        compare_spend: c?.spend ?? null,
      };
    }),
    // 내부실견적서에만 있던 추가 지출도 정산서에서 보여야 한다 (리뷰 M7)
    ...compareExtras.map((c) => ({
      base_section: null,
      base_name: null,
      base_amount: 0,
      compare_note: c.note,
      compare_spend: c.spend,
    })),
  ];
  if (rows.length > 0) {
    await supabase.from("project_cost_lines").insert(
      rows.map((r, i) => ({
        tenant_id: gate.actor.tenantId,
        sheet_id: created.id,
        sort_order: (i + 1) * 10,
        ...r,
      }))
    );
  }

  await logQuote(gate.actor, {
    docType: kind, docId: created.id, projectId, version,
    action: "doc.create", after: `v${version}`,
  });
  revalidate();
  return { ok: true, id: created.id };
}

// ── 기입 ────────────────────────────────────────────────────────────────────

const sheetPatchSchema = z.object({
  travelNote: z.string().max(200).nullable().optional(),
  travelAmount: amount.optional(),
  travelRefundable: z.boolean().optional(),
  reserveNote: z.string().max(200).nullable().optional(),
  reserveAmount: amount.optional(),
  reserveRefundable: z.boolean().optional(),
});
export type CostSheetPatch = z.infer<typeof sheetPatchSchema>;

const SHEET_COLUMNS: Record<keyof CostSheetPatch, string> = {
  travelNote: "travel_note", travelAmount: "travel_amount", travelRefundable: "travel_refundable",
  reserveNote: "reserve_note", reserveAmount: "reserve_amount", reserveRefundable: "reserve_refundable",
};
const SHEET_LABELS: Record<keyof CostSheetPatch, string> = {
  travelNote: "출장교통비 비고", travelAmount: "출장교통비", travelRefundable: "출장교통비 부가세 환급",
  reserveNote: "예비비 비고", reserveAmount: "사업담당자 예비비", reserveRefundable: "예비비 부가세 환급",
};

export async function updateCostSheet(sheetId: string, patch: CostSheetPatch): Promise<CostResult> {
  const parsed = sheetPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const open = await openSheet(sheetId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;

  const { data: before } = await supabase
    .from("project_cost_sheets")
    .select("travel_note, travel_amount, travel_refundable, reserve_note, reserve_amount, reserve_refundable")
    .eq("id", sheetId)
    .maybeSingle();
  if (!before) return { ok: false, error: "문서를 찾을 수 없습니다." };

  const update: TablesUpdate<"project_cost_sheets"> = { updated_by: actor.userId };
  const changes: { field: keyof CostSheetPatch; before: string | null; after: string | null }[] = [];
  for (const key of Object.keys(parsed.data) as (keyof CostSheetPatch)[]) {
    const raw = parsed.data[key];
    if (raw === undefined) continue;
    const next = typeof raw === "string" ? raw.trim() || null : raw;
    const col = SHEET_COLUMNS[key];
    const prev = (before as Record<string, unknown>)[col];
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | boolean | null>)[col] = next as string | number | boolean | null;
    changes.push({
      field: key,
      before: prev === null || prev === undefined ? null : String(prev),
      after: next === null ? null : String(next),
    });
  }
  if (changes.length === 0) return { ok: true };

  const { error } = await supabase.from("project_cost_sheets").update(update).eq("id", sheetId);
  if (error) return saveError(error.message);
  for (const c of changes) {
    await logQuote(actor, {
      docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
      action: "doc.update", field: SHEET_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

const linePatchSchema = z.object({
  note: z.string().max(500).nullable().optional(),
  spend: amount.optional(),
  vatRefundable: z.boolean().optional(),
});
export type CostLinePatch = z.infer<typeof linePatchSchema>;

const LINE_COLUMNS: Record<keyof CostLinePatch, string> = {
  note: "note", spend: "spend", vatRefundable: "vat_refundable",
};
const LINE_LABELS: Record<keyof CostLinePatch, string> = {
  note: "비고", spend: "지출", vatRefundable: "부가세 환급 대상",
};

export async function updateCostLine(lineId: string, patch: CostLinePatch): Promise<CostResult> {
  if (!uuid.safeParse(lineId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const parsed = linePatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_cost_lines")
    .select("id, sheet_id, base_name, note, spend, vat_refundable")
    .eq("id", lineId)
    .maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const open = await openSheet(before.sheet_id, { forEdit: true });
  if (!open.ok) return open;
  const { actor, sheet, kind } = open;

  const update: TablesUpdate<"project_cost_lines"> = {};
  const changes: { field: keyof CostLinePatch; before: string | null; after: string | null }[] = [];
  for (const key of Object.keys(parsed.data) as (keyof CostLinePatch)[]) {
    const raw = parsed.data[key];
    if (raw === undefined) continue;
    const next = typeof raw === "string" ? raw.trim() || null : raw;
    const col = LINE_COLUMNS[key];
    const prev = (before as Record<string, unknown>)[col];
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | boolean | null>)[col] = next as string | number | boolean | null;
    changes.push({
      field: key,
      before: prev === null || prev === undefined ? null : String(prev),
      after: next === null ? null : String(next),
    });
  }
  if (changes.length === 0) return { ok: true };

  const { error } = await supabase.from("project_cost_lines").update(update).eq("id", lineId);
  if (error) return saveError(error.message);
  for (const c of changes) {
    await logQuote(actor, {
      docType: kind, docId: before.sheet_id, projectId: sheet.project_id, version: sheet.version,
      action: "item.update", itemTitle: before.base_name || "(추가 항목)",
      field: LINE_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

/** 견적에 없는 지출 줄 추가 — 왼쪽(견적 금액)은 0이라 그만큼 수익이 줄어든다 */
export async function addCostLine(
  sheetId: string,
  afterLineId: string | null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const open = await openSheet(sheetId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  const { data: rows } = await supabase
    .from("project_cost_lines")
    .select("id, sort_order")
    .eq("sheet_id", sheetId)
    .order("sort_order", { ascending: true });
  const list = rows ?? [];
  if (list.length >= 300) {
    return { ok: false, error: "한 문서에는 항목을 300개까지 넣을 수 있습니다 (상태 미충족)." };
  }
  const idx = afterLineId ? list.findIndex((r) => r.id === afterLineId) : -1;
  const sortOrder =
    idx >= 0 && list[idx + 1]
      ? Math.floor((list[idx]!.sort_order + list[idx + 1]!.sort_order) / 2)
      : (list[list.length - 1]?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("project_cost_lines")
    .insert({
      tenant_id: actor.tenantId,
      sheet_id: sheetId,
      sort_order: sortOrder,
      base_section: null,
      base_name: null,
      base_amount: 0,
    })
    .select("id")
    .single();
  if (error || !data) return saveError(error?.message ?? "");
  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "item.add", itemTitle: "(추가 항목)",
  });
  revalidate();
  return { ok: true, id: data.id };
}

/** 추가로 넣은 줄만 지운다 — 견적에서 온 줄을 지우면 왼쪽이 견적과 어긋난다 */
export async function deleteCostLine(lineId: string): Promise<CostResult> {
  if (!uuid.safeParse(lineId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_cost_lines")
    .select("id, sheet_id, base_name, note")
    .eq("id", lineId)
    .maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const open = await openSheet(before.sheet_id, { forEdit: true });
  if (!open.ok) return open;
  const { actor, sheet, kind } = open;
  if (before.base_name !== null) {
    return {
      ok: false,
      error: "견적서에서 가져온 줄은 지울 수 없습니다 (규칙). 지출을 0으로 두면 됩니다 — 견적과 줄이 어긋나면 수익 계산이 맞지 않습니다.",
    };
  }
  const { error } = await supabase.from("project_cost_lines").delete().eq("id", lineId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: kind, docId: before.sheet_id, projectId: sheet.project_id, version: sheet.version,
    action: "item.delete", itemTitle: before.note || "(추가 항목)",
  });
  revalidate();
  return { ok: true };
}

// ── 결재 ────────────────────────────────────────────────────────────────────

export async function submitCostSheet(sheetId: string): Promise<CostResult> {
  const open = await openSheet(sheetId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  const { error } = await supabase
    .from("project_cost_sheets")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: actor.userId,
      updated_by: actor.userId,
    })
    .eq("id", sheetId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "doc.submit", after: `v${sheet.version}`,
  });
  revalidate();
  return { ok: true };
}

export async function approveCostSheet(sheetId: string): Promise<CostResult> {
  const open = await openSheet(sheetId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  if (sheet.status !== "submitted") {
    return { ok: false, error: "결재 상신된 문서만 승인할 수 있습니다 (상태 미충족)." };
  }
  const authors = [sheet.created_by, sheet.submitted_by];
  if (authors.includes(actor.userId)) {
    return {
      ok: false,
      error: `본인이 작성하거나 상신한 ${KIND_LABEL[kind]}는 스스로 승인할 수 없습니다 (권한 규칙). 상급자에게 승인을 요청하세요.`,
    };
  }
  if (!(await isAbove(actor.grade, authors))) {
    return {
      ok: false,
      error: `${KIND_LABEL[kind]}는 작성자·상신자보다 상위 권한단계의 상급자만 승인할 수 있습니다 (권한 규칙).`,
    };
  }
  const { error } = await supabase
    .from("project_cost_sheets")
    .update({
      status: "confirmed",
      approved_at: new Date().toISOString(),
      approved_by: actor.userId,
      updated_by: actor.userId,
    })
    .eq("id", sheetId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "doc.approve", after: `v${sheet.version} 확정`,
  });
  revalidate();
  return { ok: true };
}

export async function rejectCostSheet(sheetId: string, reason: string): Promise<CostResult> {
  const open = await openSheet(sheetId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  if (sheet.status !== "submitted") {
    return { ok: false, error: "결재 상신된 문서만 반려할 수 있습니다 (상태 미충족)." };
  }
  if (!(await isAbove(actor.grade, [sheet.created_by, sheet.submitted_by]))) {
    return { ok: false, error: "작성자·상신자보다 상위 권한단계의 상급자만 반려할 수 있습니다 (권한 규칙)." };
  }
  const text = reason.trim();
  if (!text) return { ok: false, error: "반려 사유를 입력하세요." };
  const { error } = await supabase
    .from("project_cost_sheets")
    .update({ status: "draft", submitted_at: null, submitted_by: null, updated_by: actor.userId })
    .eq("id", sheetId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "doc.reject", after: text.slice(0, 400),
  });
  revalidate();
  return { ok: true };
}

/** 상급자가 하급자에게 다음 버전 작성을 연다 (기획 지시: 상급자 승인하에 하급자가 수정) */
export async function grantCostSheetEdit(
  sheetId: string,
  userId: string | null
): Promise<CostResult> {
  const open = await openSheet(sheetId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  if (sheet.status !== "confirmed") {
    return { ok: false, error: "확정된 문서에만 수정 허용을 지정할 수 있습니다 (상태 미충족)." };
  }
  // 승인한 본인이 최상위 등급(대표)이면 '자기보다 위'가 없다 — 그러면 아무도
  // 고칠 수 없는 문서가 된다 (리뷰 H1)
  if (
    actor.userId !== sheet.approved_by &&
    !(await isAbove(actor.grade, [sheet.approved_by ?? sheet.created_by]))
  ) {
    return { ok: false, error: "수정 허용은 승인한 상급자 본인 또는 그보다 상위 권한자만 지정할 수 있습니다 (권한 규칙)." };
  }
  if (userId !== null) {
    if (!uuid.safeParse(userId).success) return { ok: false, error: "담당자를 확인할 수 없습니다." };
    const { data: target } = await supabase.from("users").select("id").eq("id", userId).maybeSingle();
    if (!target) return { ok: false, error: "담당자를 찾을 수 없습니다. 목록에서 다시 선택하세요." };
  }
  const { error } = await supabase
    .from("project_cost_sheets")
    .update({
      edit_grant_to: userId,
      edit_grant_by: userId ? actor.userId : null,
      edit_grant_at: userId ? new Date().toISOString() : null,
      updated_by: actor.userId,
    })
    .eq("id", sheetId);
  if (error) return saveError(error.message);
  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "doc.edit_grant", after: userId ? "수정 허용" : "수정 허용 해제",
  });
  revalidate();
  return { ok: true };
}

/** 확정본을 복사한 다음 버전 초안 — 상급자 본인이거나 수정 허용을 받은 담당자만 */
export async function newCostSheetVersion(
  sheetId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const open = await openSheet(sheetId, { forEdit: false });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  if (sheet.status !== "confirmed") {
    return { ok: false, error: "확정된 문서에서만 새 버전을 만들 수 있습니다 (상태 미충족)." };
  }
  const granted = sheet.edit_grant_to === actor.userId;
  const isApprover = actor.userId === sheet.approved_by;
  if (!granted && !isApprover && !(await isAbove(actor.grade, [sheet.approved_by ?? sheet.created_by]))) {
    return {
      ok: false,
      error: `확정된 ${KIND_LABEL[kind]}는 상급자가 직접 고치거나, 상급자가 '수정 허용'으로 지정한 담당자만 새 버전을 만들 수 있습니다 (권한 규칙).`,
    };
  }
  const { data: openDraft } = await supabase
    .from("project_cost_sheets")
    .select("id, version")
    .eq("project_id", sheet.project_id)
    .eq("kind", sheet.kind)
    .neq("status", "confirmed")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openDraft) {
    return {
      ok: false,
      error: `작성 중인 ${KIND_LABEL[kind]}(v${openDraft.version})가 이미 있습니다 (상태 미충족).`,
    };
  }

  // 옛 버전 탭에서 눌러도 항상 마지막 버전 뒤에 붙인다 — 종전에는 version+1이
  // 이미 있는 번호와 부딪혀 "시스템 오류"로 끝났다 (리뷰 M1)
  const { data: last } = await supabase
    .from("project_cost_sheets")
    .select("version")
    .eq("project_id", sheet.project_id)
    .eq("kind", sheet.kind)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && last.version !== sheet.version) {
    return {
      ok: false,
      error: `이 문서는 최신 버전이 아닙니다 (상태 미충족). v${last.version}에서 새 버전을 만드세요.`,
    };
  }

  const { data: src } = await supabase.from("project_cost_sheets").select("*").eq("id", sheetId).maybeSingle();
  if (!src) return { ok: false, error: "문서를 찾을 수 없습니다." };
  const version = (last?.version ?? sheet.version) + 1;

  const { data: created, error } = await supabase
    .from("project_cost_sheets")
    .insert({
      tenant_id: actor.tenantId,
      project_id: sheet.project_id,
      kind: sheet.kind,
      version,
      status: "draft",
      quote_id: src.quote_id,
      source_sheet_id: src.source_sheet_id,
      source_version: src.source_version,
      base_total: src.base_total,
      base_vat: src.base_vat,
      base_proposal: src.base_proposal,
      base_trimmed: src.base_trimmed,
      travel_note: src.travel_note,
      travel_amount: src.travel_amount,
      travel_refundable: src.travel_refundable,
      reserve_note: src.reserve_note,
      reserve_amount: src.reserve_amount,
      reserve_refundable: src.reserve_refundable,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select("id")
    .single();
  if (error || !created) return saveError(error?.message ?? "");

  const { data: lines } = await supabase
    .from("project_cost_lines")
    .select("sort_order, base_section, base_name, base_amount, compare_note, compare_spend, note, spend, vat_refundable")
    .eq("sheet_id", sheetId)
    .order("sort_order", { ascending: true });
  if (lines && lines.length > 0) {
    await supabase.from("project_cost_lines").insert(
      lines.map((l) => ({ ...l, tenant_id: actor.tenantId, sheet_id: created.id }))
    );
  }

  await logQuote(actor, {
    docType: kind, docId: created.id, projectId: sheet.project_id, version,
    action: "doc.new_version", before: `v${sheet.version}`, after: `v${version}`,
  });
  revalidate();
  return { ok: true, id: created.id };
}

/**
 * 원본(견적서) 최신본으로 왼쪽을 다시 맞춘다 — 내부실견적서 초안에서만.
 *
 * 줄을 지우고 다시 넣는 작업이라 **한 트랜잭션(RPC)** 으로 돌린다. 종전에는
 * DELETE와 INSERT가 별도 요청이라 중간에 실패하면 기입한 지출이 통째로
 * 사라졌다 (리뷰 H3). 이어 받을 값도 순서(인덱스)가 아니라 (항목, 세부내역)
 * 짝으로 찾는다 — 견적서 중간에 한 줄이 끼면 그 아래 지출이 전부 밀렸다.
 */
export async function resyncCostSheet(
  sheetId: string
): Promise<{ ok: true; matched: number; orphaned: number } | { ok: false; error: string }> {
  const open = await openSheet(sheetId, { forEdit: true });
  if (!open.ok) return open;
  const { supabase, actor, sheet, kind } = open;
  if (kind !== "internal") {
    return {
      ok: false,
      error: "정산서의 왼쪽은 확정된 내부실견적서입니다 (규칙). 견적서 갱신은 내부실견적서에서 반영하세요.",
    };
  }

  const latest = await latestQuote(sheet.project_id, { issuedOnly: true })
    ?? (await latestQuote(sheet.project_id, { issuedOnly: false }));
  if (!latest) return { ok: false, error: "견적서를 찾을 수 없습니다 (상태 미충족)." };

  const base = await baseLinesFromQuote(latest.id);
  if (!base) return { ok: false, error: "견적서를 읽을 수 없습니다." };

  const { data: current } = await supabase
    .from("project_cost_lines")
    .select("base_section, base_name, note, spend, vat_refundable, compare_note, compare_spend, sort_order")
    .eq("sheet_id", sheetId)
    .order("sort_order", { ascending: true });
  const kept = new Map<string, (typeof current extends (infer T)[] | null ? T : never)>();
  const extras: NonNullable<typeof current> = [];
  for (const l of current ?? []) {
    if (l.base_name === null) extras.push(l);
    else kept.set(keyOfLine(l.base_section, l.base_name), l);
  }

  let matched = 0;
  const nextLines = base.lines.map((l) => {
    const prev = kept.get(keyOfLine(l.baseSection, l.baseName));
    if (prev) {
      matched += 1;
      kept.delete(keyOfLine(l.baseSection, l.baseName));
    }
    return {
      base_section: l.baseSection,
      base_name: l.baseName,
      base_amount: l.baseAmount,
      compare_note: prev?.compare_note ?? null,
      compare_spend: prev?.compare_spend ?? null,
      note: prev?.note ?? null,
      spend: prev?.spend ?? 0,
      vat_refundable: prev?.vat_refundable ?? false,
    };
  });
  // 새 견적서에서 사라진 항목의 지출은 버리지 않는다 — '연결 끊김'으로 남겨
  // 담당자가 옮기거나 지우게 한다 (조용히 사라지면 금액이 맞지 않는다)
  const orphans = Array.from(kept.values()).map((l) => ({
    base_section: null,
    base_name: null,
    base_amount: 0,
    compare_note: l.compare_note,
    compare_spend: l.compare_spend,
    note: `[연결 끊김: ${l.base_section ?? ""} ${l.base_name ?? ""}] ${l.note ?? ""}`.trim().slice(0, 500),
    spend: l.spend,
    vat_refundable: l.vat_refundable,
  }));
  const keepExtras = extras.map((l) => ({
    base_section: null,
    base_name: null,
    base_amount: 0,
    compare_note: l.compare_note,
    compare_spend: l.compare_spend,
    note: l.note,
    spend: l.spend,
    vat_refundable: l.vat_refundable,
  }));

  const { error: rpcError } = await supabase.rpc("resync_project_cost_lines", {
    p_sheet_id: sheetId,
    p_lines: [...nextLines, ...keepExtras, ...orphans],
  });
  if (rpcError) {
    return {
      ok: false,
      error: await explainActionError(
        rpcError.message,
        "견적서 반영에 실패했습니다. 기존 내용은 그대로 남아 있습니다 — 잠시 후 다시 시도해 주세요."
      ),
    };
  }

  const { error } = await supabase
    .from("project_cost_sheets")
    .update({
      quote_id: latest.id,
      source_version: latest.version,
      base_total: base.totals.grandTotal,
      base_vat: base.totals.vat,
      base_proposal: base.totals.proposal,
      base_trimmed: base.totals.trimmed,
      updated_by: actor.userId,
    })
    .eq("id", sheetId);
  if (error) return saveError(error.message, "견적서 반영에 실패했습니다.");

  await logQuote(actor, {
    docType: kind, docId: sheetId, projectId: sheet.project_id, version: sheet.version,
    action: "doc.resync",
    after: `견적서 v${latest.version} 반영 (이어받음 ${matched}건${orphans.length ? `, 연결 끊김 ${orphans.length}건` : ""})`,
  });
  revalidate();
  return { ok: true, matched, orphaned: orphans.length };
}
