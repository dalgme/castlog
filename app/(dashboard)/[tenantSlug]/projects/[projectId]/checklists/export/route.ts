import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse, type SheetRows } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import {
  CHECKLIST_COLUMNS,
  CHECKLIST_KIND_LABELS,
  autoDueDate,
  isChecklistKind,
  type ChecklistKind,
} from "@/lib/checklists/kinds";

export const dynamic = "force-dynamic";

/**
 * 프로젝트 체크리스트 엑셀 저장 (기획 지시 2026-09-21).
 * ?checklist=<id> 면 그 시트만, 없으면 프로젝트의 모든 시트를 시트별로 담는다.
 * 열람은 RLS(프로젝트 열람 범위) — 범위 밖 프로젝트는 404.
 * 첫 시트는 프로젝트 정보(상단 자동 채움과 같은 내용).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string; projectId: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  if (!hasSupabaseEnv() || !user) {
    return NextResponse.redirect(new URL(`/${params.tenantSlug}/projects`, request.url));
  }
  const supabase = createClient();
  const onlyId = request.nextUrl.searchParams.get("checklist");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, business_year, client_name, host_org, executor_org, starts_on, ends_on, dday_date")
    .eq("id", params.projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json(
      { error: "프로젝트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." },
      { status: 404 }
    );
  }

  let listQuery = supabase
    .from("project_checklists")
    .select("id, kind, name, dday_date")
    .eq("project_id", project.id)
    .order("created_at", { ascending: true });
  if (onlyId) listQuery = listQuery.eq("id", onlyId);
  const { data: checklists } = await listQuery;
  const lists = (checklists ?? []).filter((c): c is typeof c & { kind: ChecklistKind } => isChecklistKind(c.kind));
  if (lists.length === 0) {
    return NextResponse.json({ error: "저장할 체크리스트가 없습니다." }, { status: 404 });
  }

  const listIds = lists.map((c) => c.id);
  const [{ data: items }, { data: users }] = await Promise.all([
    supabase
      .from("project_checklist_items")
      .select(
        "id, checklist_id, phase, category, subcategory, title, offset_days, quantity, assignee_user_id, planned_due_on, completed_on, note, memo, check1, check2, decision, applicable, sort_order"
      )
      .in("checklist_id", listIds)
      .order("sort_order", { ascending: true }),
    supabase.from("users").select("id, name"),
  ]);
  const nameById = new Map((users ?? []).map((u) => [u.id, u.name]));

  const info: SheetRows = [
    { 항목: "프로젝트명", 값: project.name },
    { 항목: "사업연도", 값: project.business_year ?? "" },
    { 항목: "사업 시작일", 값: project.starts_on ?? "" },
    { 항목: "사업 종료일", 값: project.ends_on ?? "" },
    { 항목: "발주처", 값: project.client_name ?? "" },
    { 항목: "주관", 값: project.host_org ?? "" },
    { 항목: "수행기관", 값: project.executor_org ?? "" },
    { 항목: "D-Day", 값: project.dday_date ?? "" },
    { 항목: "저장 일시", 값: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") },
  ];
  const sheets: [string, SheetRows][] = [["프로젝트 정보", info]];

  // 같은 이름의 시트가 둘이면 엑셀이 거부한다 — 뒤에 번호를 붙인다
  const usedNames = new Set<string>(["프로젝트 정보"]);
  for (const c of lists) {
    const dday = c.dday_date ?? project.dday_date;
    const columns = CHECKLIST_COLUMNS[c.kind];
    const rows: SheetRows = (items ?? [])
      .filter((it) => it.checklist_id === c.id)
      .map((it, i) => {
        const row: Record<string, string | number | null> = { No: i + 1 };
        for (const col of columns) {
          switch (col.key) {
            case "phase": row[col.label] = it.phase ?? ""; break;
            case "category": row[col.label] = it.category ?? ""; break;
            case "subcategory": row[col.label] = it.subcategory ?? ""; break;
            case "title": row[col.label] = it.title; break;
            case "quantity": row[col.label] = it.quantity ?? ""; break;
            case "assignee": row[col.label] = it.assignee_user_id ? (nameById.get(it.assignee_user_id) ?? "") : ""; break;
            case "offsetDays":
              row["권장(D±)"] = it.offset_days === null ? "" : `D${it.offset_days >= 0 ? "+" : "-"}${Math.abs(it.offset_days)}`;
              row["권장 마감일"] = autoDueDate(dday, it.offset_days) ?? "";
              break;
            case "plannedDue": row[col.label] = it.planned_due_on ?? ""; break;
            case "completedOn": row[col.label] = it.completed_on ?? ""; break;
            case "note": row[col.label] = it.note ?? ""; break;
            case "check1": row[col.label] = it.check1 ?? ""; break;
            case "check2": row[col.label] = it.check2 ?? ""; break;
            case "decision": row[col.label] = it.decision ?? ""; break;
            case "applicable": row[col.label] = it.applicable ?? ""; break;
            case "autoDue": break;
          }
        }
        row["메모"] = it.memo ?? "";
        return row;
      });
    let name = (c.name || CHECKLIST_KIND_LABELS[c.kind]).replace(/[\\/?*[\]:]/g, " ").slice(0, 28);
    let n = 2;
    while (usedNames.has(name)) name = `${name.slice(0, 25)} ${n++}`;
    usedNames.add(name);
    sheets.push([name, rows]);
  }

  await logAudit(supabase, user, {
    action: "export.checklists",
    resourceType: "project",
    resourceId: project.id,
    afterData: { sheets: lists.length, items: items?.length ?? 0, checklist: onlyId },
  });

  return xlsxResponse(`${project.name}_체크리스트`, sheets);
}
