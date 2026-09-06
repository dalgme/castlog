"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { isChecklistKind, type ChecklistLogRow } from "@/lib/checklists/kinds";
import { GROUP_FIELDS, GROUP_FIELD_LABELS, type GroupField } from "@/lib/checklists/groups";
import { applyOrder, nextSortOrder } from "@/lib/checklists/order";
import {
  logChecklist,
  requireTemplateEditor,
  requireTenantStaff,
} from "@/lib/checklists/server";

/**
 * 체크리스트 표준시트 편집 (설정 > 체크리스트 표준시트).
 * 임직원 누구나 수정한다 (기획 01·11·13·14). 모든 변경은 checklist_logs에
 * 언제·누가·어떤 항목을 어떻게 바꿨는지 남긴다.
 */

export type ChecklistActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();
const SYSTEM_FAIL = "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";

const templateItemPatchSchema = z.object({
  phase: z.string().max(40).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  subcategory: z.string().max(80).nullable().optional(),
  title: z.string().min(1, "내용을 입력하세요.").max(500).optional(),
  offsetDays: z.number().int().min(-365).max(365).nullable().optional(),
  quantity: z.string().max(80).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type TemplateItemPatch = z.infer<typeof templateItemPatchSchema>;

const FIELD_LABELS: Record<keyof TemplateItemPatch, string> = {
  phase: "시기",
  category: "구분",
  subcategory: "세부 분류",
  title: "내용",
  offsetDays: "권장 마감일",
  quantity: "수량",
  note: "참고사항",
};

function revalidate() {
  revalidatePath("/[tenantSlug]/settings/checklists", "page");
}

export async function createTemplate(
  kind: string,
  name: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!isChecklistKind(kind)) return { ok: false, error: "종류를 확인하세요." };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) return { ok: false, error: "시트 이름을 1~120자로 입력하세요." };
  const supabase = createClient();
  const { data: last } = await supabase
    .from("checklist_templates")
    .select("sort_order")
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("checklist_templates")
    .insert({
      tenant_id: gate.actor.tenantId,
      kind,
      name: trimmed,
      sort_order: (last?.sort_order ?? 0) + 10,
      created_by: gate.actor.userId,
      updated_by: gate.actor.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template",
    action: "template.create",
    templateId: data.id,
    after: trimmed,
  });
  revalidate();
  return { ok: true, id: data.id };
}

export async function renameTemplate(templateId: string, name: string): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) return { ok: false, error: "시트 이름을 1~120자로 입력하세요." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("checklist_templates").select("name").eq("id", templateId).maybeSingle();
  const { error } = await supabase
    .from("checklist_templates")
    .update({ name: trimmed, updated_by: gate.actor.userId })
    .eq("id", templateId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template", action: "template.rename", templateId,
    field: "이름", before: before?.name ?? null, after: trimmed,
  });
  revalidate();
  return { ok: true };
}

export async function deleteTemplate(templateId: string): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: t } = await supabase
    .from("checklist_templates").select("kind, name").eq("id", templateId).maybeSingle();
  if (!t) return { ok: false, error: "시트를 찾을 수 없습니다." };
  if (t.kind === "common" || t.kind === "typed") {
    return {
      ok: false,
      error: "공통·유형별 시트는 삭제하지 않습니다 (규칙) — 항목을 비우거나 수정해 쓰세요.",
    };
  }
  const { error } = await supabase.from("checklist_templates").delete().eq("id", templateId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template", action: "template.delete", templateId, before: t.name,
  });
  revalidate();
  return { ok: true };
}

export async function addTemplateItem(
  templateId: string,
  afterItemId: string | null,
  patch: TemplateItemPatch
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const parsed = templateItemPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  const title = parsed.data.title?.trim();
  if (!title) return { ok: false, error: "내용을 입력하세요." };
  const supabase = createClient();
  const sortOrder = await nextSortOrder(supabase, "checklist_template_items", "template_id", templateId, afterItemId);
  const { data, error } = await supabase
    .from("checklist_template_items")
    .insert({
      tenant_id: gate.actor.tenantId,
      template_id: templateId,
      sort_order: sortOrder,
      phase: parsed.data.phase ?? null,
      category: parsed.data.category ?? null,
      subcategory: parsed.data.subcategory ?? null,
      title,
      offset_days: parsed.data.offsetDays ?? null,
      quantity: parsed.data.quantity ?? null,
      note: parsed.data.note ?? null,
      created_by: gate.actor.userId,
      updated_by: gate.actor.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template", action: "item.add", templateId, itemId: data.id, itemTitle: title, after: title,
  });
  revalidate();
  return { ok: true, id: data.id };
}

export async function updateTemplateItem(
  itemId: string,
  patch: TemplateItemPatch
): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const parsed = templateItemPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("checklist_template_items")
    .select("template_id, phase, category, subcategory, title, offset_days, quantity, note")
    .eq("id", itemId)
    .maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const update: TablesUpdate<"checklist_template_items"> = { updated_by: gate.actor.userId };
  const changes: { field: keyof TemplateItemPatch; before: string | null; after: string | null }[] = [];
  const map: Record<keyof TemplateItemPatch, string> = {
    phase: "phase", category: "category", subcategory: "subcategory", title: "title",
    offsetDays: "offset_days", quantity: "quantity", note: "note",
  };
  for (const key of Object.keys(parsed.data) as (keyof TemplateItemPatch)[]) {
    const v = parsed.data[key];
    if (v === undefined) continue;
    const next = typeof v === "string" ? v.trim() || null : v;
    const prev = before[map[key] as keyof typeof before] as string | number | null;
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | null>)[map[key]] = next;
    changes.push({ field: key, before: prev === null ? null : String(prev), after: next === null ? null : String(next) });
  }
  if (changes.length === 0) return { ok: true };
  if (update.title === null) return { ok: false, error: "내용을 입력하세요." };
  const { error } = await supabase.from("checklist_template_items").update(update).eq("id", itemId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  for (const c of changes) {
    await logChecklist(gate.actor, {
      scope: "template", action: "item.update", templateId: before.template_id, itemId,
      itemTitle: before.title, field: FIELD_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

export async function deleteTemplateItem(itemId: string): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("checklist_template_items").select("template_id, title").eq("id", itemId).maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const { error } = await supabase.from("checklist_template_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template", action: "item.delete", templateId: before.template_id, itemId,
    itemTitle: before.title, before: before.title,
  });
  revalidate();
  return { ok: true };
}

const groupValuesSchema = z.object({
  phase: z.string().max(40).nullable(),
  category: z.string().max(80).nullable(),
  subcategory: z.string().max(80).nullable(),
});
const adoptSchema = z.object({ itemIds: z.array(uuid).min(1).max(500), values: groupValuesSchema });
export type TemplateGroupAdopt = z.infer<typeof adoptSchema>;

/** 순서 저장 + 다른 분류 묶음에 놓은 항목은 그 분류를 이어받는다 (기획 지시 2026-09-06) */
export async function reorderTemplateItems(
  templateId: string,
  orderedIds: string[],
  adopt?: TemplateGroupAdopt | null
): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success || !z.array(uuid).max(2000).safeParse(orderedIds).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다." };
  }
  const parsedAdopt = adopt ? adoptSchema.safeParse(adopt) : null;
  if (parsedAdopt && !parsedAdopt.success) return { ok: false, error: "분류 값을 확인하세요." };
  const supabase = createClient();
  const { data: t } = await supabase.from("checklist_templates").select("kind").eq("id", templateId).maybeSingle();
  if (!t) return { ok: false, error: "시트를 찾을 수 없습니다." };
  // 분류 이어받기를 먼저 — 실패하면 순서도 저장하지 않는다 (리뷰 L1)
  let adopted = false;
  if (parsedAdopt?.success) {
    const fields = isChecklistKind(t.kind) ? GROUP_FIELDS[t.kind] : [];
    const { itemIds, values } = parsedAdopt.data;
    const update: TablesUpdate<"checklist_template_items"> = { updated_by: gate.actor.userId };
    for (const f of fields) update[f] = values[f]?.trim() || null;
    const { data: moved } = await supabase
      .from("checklist_template_items")
      .select("id, title, phase, category, subcategory").in("id", itemIds).eq("template_id", templateId);
    if (fields.length > 0 && moved && moved.length > 0) {
      const { error } = await supabase
        .from("checklist_template_items").update(update).in("id", moved.map((m) => m.id)).eq("template_id", templateId);
      if (error) return { ok: false, error: SYSTEM_FAIL };
      const label = fields.map((f) => update[f] ?? "(미분류)").join(" › ");
      for (const m of moved) {
        await logChecklist(gate.actor, {
          scope: "template", action: "item.move", templateId, itemId: m.id, itemTitle: m.title, field: "분류",
          before: fields.map((f) => m[f] ?? "(미분류)").join(" › "), after: label,
        });
      }
      adopted = true;
    }
  }
  await applyOrder(supabase, "checklist_template_items", "template_id", templateId, orderedIds, gate.actor.userId);
  if (!adopted) {
    await logChecklist(gate.actor, { scope: "template", action: "item.reorder", templateId, after: `${orderedIds.length}개 항목 순서 변경` });
  }
  revalidate();
  return { ok: true };
}

/** 묶음 머리행에서 분류 이름 변경 — 묶음의 모든 항목에 적용 */
export async function renameTemplateGroup(
  templateId: string,
  itemIds: string[],
  field: GroupField,
  value: string | null
): Promise<ChecklistActionResult> {
  const gate = await requireTemplateEditor();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success || !z.array(uuid).min(1).max(500).safeParse(itemIds).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다." };
  }
  if (field !== "phase" && field !== "category" && field !== "subcategory") {
    return { ok: false, error: "분류 열을 확인하세요." };
  }
  const next = value?.trim() || null;
  if (next && next.length > (field === "phase" ? 40 : 80)) return { ok: false, error: "분류 이름이 너무 깁니다." };
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("checklist_template_items").select("id, phase, category, subcategory").in("id", itemIds).eq("template_id", templateId);
  if (!rows || rows.length === 0) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const before = rows[0]![field] ?? null;
  if (rows.every((r) => (r[field] ?? "") === (next ?? ""))) return { ok: true };
  const update: TablesUpdate<"checklist_template_items"> = { updated_by: gate.actor.userId };
  update[field] = next;
  const { error } = await supabase
    .from("checklist_template_items").update(update).in("id", rows.map((r) => r.id)).eq("template_id", templateId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "template", action: "group.rename", templateId,
    itemTitle: `${rows.length}개 항목`, field: GROUP_FIELD_LABELS[field], before, after: next,
  });
  revalidate();
  return { ok: true };
}

export async function getTemplateLogs(
  templateId: string
): Promise<{ ok: true; rows: ChecklistLogRow[] } | { ok: false; error: string }> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data } = await supabase
    .from("checklist_logs")
    .select("id, created_at, actor_name, action, item_title, field, before_value, after_value")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(300);
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id, at: r.created_at, actorName: r.actor_name, action: r.action,
      itemTitle: r.item_title, field: r.field, before: r.before_value, after: r.after_value,
    })),
  };
}
