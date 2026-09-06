import "server-only";

import { createClient } from "@/lib/supabase/server";
import { CHECKLIST_KINDS, type ChecklistKind } from "./kinds";
import type { TemplateView } from "./template-view";

/**
 * 회사 표준시트 조회 (RLS: 같은 회사 임직원 전체 공유). 설정 페이지와 프로젝트
 * 체크리스트 탭의 '설정' 팝업이 같은 함수를 쓴다. 항목 수정도 시트 수정으로 보아
 * 마지막 수정 시각·수정자를 함께 돌려준다.
 */
export async function loadTemplateViews(
  kind?: ChecklistKind
): Promise<{ templates: TemplateView[]; missingTable: boolean }> {
  const supabase = createClient();
  let query = supabase
    .from("checklist_templates")
    .select("id, kind, name, sort_order, updated_at, updated_by")
    .eq("is_active", true)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true });
  if (kind) query = query.eq("kind", kind);
  const { data: rows, error } = await query;
  if (error?.code === "42P01") return { templates: [], missingTable: true };
  const ids = (rows ?? []).map((r) => r.id);
  const { data: items } = ids.length
    ? await supabase
        .from("checklist_template_items")
        .select(
          "id, template_id, sort_order, phase, category, subcategory, title, offset_days, quantity, note, updated_at, updated_by"
        )
        .in("template_id", ids)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const editorIds = Array.from(
    new Set(
      [...(rows ?? []).map((r) => r.updated_by), ...(items ?? []).map((it) => it.updated_by)].filter(
        (v): v is string => Boolean(v)
      )
    )
  );
  const { data: editors } = editorIds.length
    ? await supabase.from("users").select("id, name").in("id", editorIds)
    : { data: [] };
  const editorName = new Map((editors ?? []).map((u) => [u.id, u.name]));
  const templates = (rows ?? [])
    .filter((r): r is typeof r & { kind: ChecklistKind } =>
      (CHECKLIST_KINDS as readonly string[]).includes(r.kind)
    )
    .map((r) => {
      const own = (items ?? []).filter((it) => it.template_id === r.id);
      const lastItem = own.reduce<(typeof own)[number] | null>(
        (m, it) => (m && m.updated_at > it.updated_at ? m : it),
        null
      );
      const latest =
        lastItem && lastItem.updated_at > r.updated_at
          ? { at: lastItem.updated_at, by: lastItem.updated_by }
          : { at: r.updated_at, by: r.updated_by };
      return {
        id: r.id,
        kind: r.kind,
        name: r.name,
        updatedAt: latest.at,
        updatedByName: latest.by ? (editorName.get(latest.by) ?? null) : null,
        items: own.map((it) => ({
          id: it.id,
          phase: it.phase,
          category: it.category,
          subcategory: it.subcategory,
          title: it.title,
          offsetDays: it.offset_days,
          quantity: it.quantity,
          note: it.note,
        })),
      };
    });
  return { templates, missingTable: false };
}
