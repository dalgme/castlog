import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * 체크리스트 항목 정렬 (표준시트·프로젝트 공용). sort_order는 10 간격으로 두고,
 * 사이에 끼울 틈이 없으면 전체를 다시 번호 매긴다.
 *
 * 일괄 저장은 DB 함수(reorder_*_items, security invoker — 호출자 RLS 적용)로
 * 한 번에 한다. 함수가 아직 없는 DB(SQL 먼저)에서는 건별 갱신으로 떨어진다.
 */
type Supabase = ReturnType<typeof createClient>;
type OrderTable = "checklist_template_items" | "project_checklist_items";
type ParentKey = "template_id" | "checklist_id";

async function listOrder(supabase: Supabase, table: OrderTable, parentId: string) {
  const { data } =
    table === "checklist_template_items"
      ? await supabase.from("checklist_template_items").select("id, sort_order").eq("template_id", parentId).order("sort_order", { ascending: true })
      : await supabase.from("project_checklist_items").select("id, sort_order").eq("checklist_id", parentId).order("sort_order", { ascending: true });
  return data ?? [];
}

async function setOrderOne(supabase: Supabase, table: OrderTable, parentId: string, id: string, sortOrder: number, updatedBy: string | null) {
  if (table === "checklist_template_items") {
    await supabase
      .from("checklist_template_items")
      .update({ sort_order: sortOrder, ...(updatedBy ? { updated_by: updatedBy } : {}) })
      .eq("id", id)
      .eq("template_id", parentId);
  } else {
    await supabase
      .from("project_checklist_items")
      .update({ sort_order: sortOrder, ...(updatedBy ? { updated_by: updatedBy } : {}) })
      .eq("id", id)
      .eq("checklist_id", parentId);
  }
}

export async function nextSortOrder(
  supabase: Supabase,
  table: OrderTable,
  _parentKey: ParentKey,
  parentId: string,
  afterItemId: string | null
): Promise<number> {
  void _parentKey;
  const list = await listOrder(supabase, table, parentId);
  if (!afterItemId) return (list[list.length - 1]?.sort_order ?? 0) + 10;
  const idx = list.findIndex((r) => r.id === afterItemId);
  if (idx < 0) return (list[list.length - 1]?.sort_order ?? 0) + 10;
  const cur = list[idx]!.sort_order;
  const next = list[idx + 1]?.sort_order;
  if (next === undefined) return cur + 10;
  if (next - cur > 1) return Math.floor((cur + next) / 2);
  await applyOrder(supabase, table, _parentKey, parentId, list.map((r) => r.id), null);
  return (idx + 1) * 10 + 5;
}

export async function applyOrder(
  supabase: Supabase,
  table: OrderTable,
  _parentKey: ParentKey,
  parentId: string,
  orderedIds: string[],
  updatedBy: string | null
): Promise<void> {
  void _parentKey;
  // 이 부모에 속한 id만 — 다른 시트의 id가 섞여 와도 건드리지 않는다
  const own = new Set((await listOrder(supabase, table, parentId)).map((r) => r.id));
  const ids = orderedIds.filter((id) => own.has(id));
  if (ids.length === 0) return;
  const { error } =
    table === "checklist_template_items"
      ? await supabase.rpc("reorder_checklist_template_items", { p_ids: ids })
      : await supabase.rpc("reorder_project_checklist_items", { p_ids: ids });
  if (!error) return;
  // 함수 부재(42883/PGRST202) 등 — 건별 갱신 폴백
  for (let i = 0; i < ids.length; i += 1) {
    await setOrderOne(supabase, table, parentId, ids[i]!, (i + 1) * 10, updatedBy);
  }
}
