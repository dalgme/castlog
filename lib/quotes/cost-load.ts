import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 내부실견적서·정산서 조회 (RLS: 프로젝트 팀). 탭 화면과 엑셀이 같은 로더를 쓴다.
 */

export type CostSheetKind = "internal" | "settlement";
export type CostSheetStatus = "draft" | "submitted" | "confirmed";

export type LoadedCostLine = {
  id: string;
  baseSection: string | null;
  baseName: string | null;
  baseAmount: number;
  compareNote: string | null;
  compareSpend: number | null;
  note: string | null;
  spend: number;
  vatRefundable: boolean;
};

export type LoadedCostSheet = {
  id: string;
  projectId: string;
  kind: CostSheetKind;
  version: number;
  status: CostSheetStatus;
  quoteId: string | null;
  sourceSheetId: string | null;
  sourceVersion: number | null;
  baseTotal: number;
  baseVat: number;
  baseProposal: number;
  baseTrimmed: number;
  travelNote: string | null;
  travelAmount: number;
  travelRefundable: boolean;
  reserveNote: string | null;
  reserveAmount: number;
  reserveRefundable: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  editGrantTo: string | null;
  editGrantToName: string | null;
  createdByName: string | null;
  updatedAt: string;
  lines: LoadedCostLine[];
};

const SHEET_COLUMNS =
  "id, project_id, kind, version, status, quote_id, source_sheet_id, source_version, " +
  "base_total, base_vat, base_proposal, base_trimmed, travel_note, travel_amount, travel_refundable, " +
  "reserve_note, reserve_amount, reserve_refundable, submitted_at, submitted_by, approved_at, approved_by, " +
  "edit_grant_to, created_by, updated_at";

type SheetRow = {
  id: string; project_id: string; kind: string; version: number; status: string;
  quote_id: string | null; source_sheet_id: string | null; source_version: number | null;
  base_total: number; base_vat: number; base_proposal: number; base_trimmed: number;
  travel_note: string | null; travel_amount: number; travel_refundable: boolean;
  reserve_note: string | null; reserve_amount: number; reserve_refundable: boolean;
  submitted_at: string | null; submitted_by: string | null;
  approved_at: string | null; approved_by: string | null;
  edit_grant_to: string | null; created_by: string | null; updated_at: string;
};

async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return new Map();
  const supabase = createClient();
  const { data } = await supabase.from("users").select("id, name").in("id", unique);
  return new Map((data ?? []).map((u) => [u.id, u.name]));
}

/** 한 프로젝트의 내부실견적서·정산서 전부 (버전 내림차순) */
export async function loadCostSheets(
  projectId: string
): Promise<{ sheets: LoadedCostSheet[]; missingTable: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_cost_sheets")
    .select(SHEET_COLUMNS)
    .eq("project_id", projectId)
    .order("version", { ascending: false });
  if (error?.code === "42P01") return { sheets: [], missingTable: true };
  const rows = (data ?? []) as unknown as SheetRow[];
  if (rows.length === 0) return { sheets: [], missingTable: false };

  const { data: lineRows } = await supabase
    .from("project_cost_lines")
    .select("id, sheet_id, base_section, base_name, base_amount, compare_note, compare_spend, note, spend, vat_refundable")
    .in("sheet_id", rows.map((r) => r.id))
    .order("sort_order", { ascending: true });
  const bySheet = new Map<string, LoadedCostLine[]>();
  for (const l of lineRows ?? []) {
    const list = bySheet.get(l.sheet_id) ?? [];
    list.push({
      id: l.id,
      baseSection: l.base_section,
      baseName: l.base_name,
      baseAmount: Number(l.base_amount),
      compareNote: l.compare_note,
      compareSpend: l.compare_spend === null ? null : Number(l.compare_spend),
      note: l.note,
      spend: Number(l.spend),
      vatRefundable: l.vat_refundable,
    });
    bySheet.set(l.sheet_id, list);
  }

  const names = await nameMap(
    rows.flatMap((r) => [r.submitted_by, r.approved_by, r.edit_grant_to, r.created_by])
  );

  return {
    sheets: rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      kind: r.kind === "settlement" ? "settlement" : "internal",
      version: r.version,
      status: (["draft", "submitted", "confirmed"] as const).includes(r.status as CostSheetStatus)
        ? (r.status as CostSheetStatus)
        : "draft",
      quoteId: r.quote_id,
      sourceSheetId: r.source_sheet_id,
      sourceVersion: r.source_version,
      baseTotal: Number(r.base_total),
      baseVat: Number(r.base_vat),
      baseProposal: Number(r.base_proposal),
      baseTrimmed: Number(r.base_trimmed),
      travelNote: r.travel_note,
      travelAmount: Number(r.travel_amount),
      travelRefundable: r.travel_refundable,
      reserveNote: r.reserve_note,
      reserveAmount: Number(r.reserve_amount),
      reserveRefundable: r.reserve_refundable,
      submittedAt: r.submitted_at,
      submittedByName: r.submitted_by ? (names.get(r.submitted_by) ?? null) : null,
      approvedAt: r.approved_at,
      approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
      editGrantTo: r.edit_grant_to,
      editGrantToName: r.edit_grant_to ? (names.get(r.edit_grant_to) ?? null) : null,
      createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
      updatedAt: r.updated_at,
      lines: bySheet.get(r.id) ?? [],
    })),
    missingTable: false,
  };
}
