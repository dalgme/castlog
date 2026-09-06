"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { gradeRank, isUserGrade } from "@/lib/auth/grades";
import {
  isChecklistKind,
  kstToday,
  type ChecklistLogRow,
} from "@/lib/checklists/kinds";
import { GROUP_FIELDS, GROUP_FIELD_LABELS, type GroupField } from "@/lib/checklists/groups";
import { applyOrder, nextSortOrder } from "@/lib/checklists/order";
import {
  logChecklist,
  requireProjectTeam,
  requireTenantStaff,
} from "@/lib/checklists/server";

/**
 * 프로젝트별 체크리스트 (기획 지시 2026-09-05).
 * 편집 자격은 프로젝트 팀(PL·PM·부PM·담당) + 전사 열람 권한자 — requireProjectTeam.
 * 모든 기입은 담당자별 로그(checklist_logs)로 남는다 (기획 15).
 */

export type Result = { ok: true } | { ok: false; error: string };
const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식(yyyy-mm-dd)을 확인하세요.")
  .refine((v) => {
    const y = Number(v.slice(0, 4));
    return y >= 2000 && y <= 2100 && !Number.isNaN(Date.parse(v));
  }, "날짜는 2000~2100년 사이여야 합니다.");
const SYSTEM_FAIL = "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.";

function revalidate() {
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
}

async function projectDday(supabase: ReturnType<typeof createClient>, projectId: string) {
  const { data: p } = await supabase
    .from("projects")
    .select("dday_date, starts_on")
    .eq("id", projectId)
    .maybeSingle();
  if (!p) return null;
  if (p.dday_date) return p.dday_date;
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("slot_date")
    .eq("project_id", projectId)
    .order("slot_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  return slot?.slot_date ?? p.starts_on ?? null;
}

type TemplateItemRow = {
  phase: string | null; category: string | null; subcategory: string | null; title: string;
  offset_days: number | null; quantity: string | null; note: string | null; sort_order: number;
};

async function insertItemsFromTemplate(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  checklistId: string,
  projectId: string,
  items: TemplateItemRow[],
  startOrder: number,
  userId: string
) {
  const rows = items.map((it, i) => ({
    tenant_id: tenantId,
    checklist_id: checklistId,
    project_id: projectId,
    sort_order: startOrder + (i + 1) * 10,
    phase: it.phase,
    category: it.category,
    subcategory: it.subcategory,
    title: it.title,
    offset_days: it.offset_days,
    quantity: it.quantity,
    note: it.note,
    created_by: userId,
    updated_by: userId,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("project_checklist_items").insert(rows.slice(i, i + 200));
    if (error) return error;
  }
  return null;
}

/** 공통 체크리스트 불러오기 — 프로젝트 체크리스트(공통)를 만든다 (기획 02) */
export async function importCommonChecklist(projectId: string): Promise<Result> {
  const gate = await requireProjectTeam(projectId);
  if (!gate.ok) return gate;
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("project_checklists").select("id").eq("project_id", projectId).eq("kind", "common").maybeSingle();
  if (existing) return { ok: false, error: "이 프로젝트에는 이미 공통 체크리스트가 있습니다. 항목은 그 표에서 추가·수정하세요." };
  const { data: template } = await supabase
    .from("checklist_templates").select("id, name").eq("kind", "common").eq("is_active", true)
    .order("sort_order", { ascending: true }).limit(1).maybeSingle();
  if (!template) return { ok: false, error: "공통 체크리스트 표준시트가 없습니다. 설정 > 체크리스트 표준시트에서 먼저 만들어 주세요." };
  const { data: items } = await supabase
    .from("checklist_template_items")
    .select("phase, category, subcategory, title, offset_days, quantity, note, sort_order")
    .eq("template_id", template.id).order("sort_order", { ascending: true });
  const dday = await projectDday(supabase, projectId);
  const { data: created, error } = await supabase
    .from("project_checklists")
    .insert({
      tenant_id: gate.actor.tenantId, project_id: projectId, kind: "common", template_id: template.id,
      name: "프로젝트 체크리스트", dday_date: dday, created_by: gate.actor.userId, updated_by: gate.actor.userId,
    })
    .select("id").single();
  if (error || !created) return { ok: false, error: SYSTEM_FAIL };
  const insErr = await insertItemsFromTemplate(supabase, gate.actor.tenantId, created.id, projectId, items ?? [], 0, gate.actor.userId);
  if (insErr) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "project", action: "checklist.create", checklistId: created.id, projectId,
    after: `${template.name} 불러오기 · ${items?.length ?? 0}개 항목`,
  });
  revalidate();
  return { ok: true };
}

/** 유형별 표준시트의 세부 카테고리를 프로젝트 체크리스트에 추가 (기획 12) */
export async function importTypedItems(
  projectId: string,
  subcategories: string[]
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const gate = await requireProjectTeam(projectId);
  if (!gate.ok) return gate;
  const list = z.array(z.string().min(1).max(80)).min(1).max(50).safeParse(subcategories);
  if (!list.success) return { ok: false, error: "불러올 세부 카테고리를 선택하세요." };
  const supabase = createClient();
  let { data: checklist } = await supabase
    .from("project_checklists").select("id").eq("project_id", projectId).eq("kind", "common").maybeSingle();
  if (!checklist) {
    const dday = await projectDday(supabase, projectId);
    const { data: created, error } = await supabase
      .from("project_checklists")
      .insert({
        tenant_id: gate.actor.tenantId, project_id: projectId, kind: "common", name: "프로젝트 체크리스트",
        dday_date: dday, created_by: gate.actor.userId, updated_by: gate.actor.userId,
      })
      .select("id").single();
    if (error || !created) return { ok: false, error: SYSTEM_FAIL };
    checklist = created;
    await logChecklist(gate.actor, { scope: "project", action: "checklist.create", checklistId: created.id, projectId, after: "빈 프로젝트 체크리스트 생성(유형별 불러오기)" });
  }
  const { data: template } = await supabase
    .from("checklist_templates").select("id").eq("kind", "typed").eq("is_active", true)
    .order("sort_order", { ascending: true }).limit(1).maybeSingle();
  if (!template) return { ok: false, error: "유형별 체크리스트 표준시트가 없습니다." };
  const { data: items } = await supabase
    .from("checklist_template_items")
    .select("phase, category, subcategory, title, offset_days, quantity, note, sort_order")
    .eq("template_id", template.id).in("subcategory", list.data).order("sort_order", { ascending: true });
  if (!items || items.length === 0) return { ok: false, error: "선택한 세부 카테고리에 항목이 없습니다." };
  const { data: last } = await supabase
    .from("project_checklist_items").select("sort_order").eq("checklist_id", checklist.id)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const insErr = await insertItemsFromTemplate(supabase, gate.actor.tenantId, checklist.id, projectId, items, last?.sort_order ?? 0, gate.actor.userId);
  if (insErr) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "project", action: "item.import", checklistId: checklist.id, projectId,
    after: `유형별 불러오기: ${list.data.join(", ")} · ${items.length}개 항목`,
  });
  revalidate();
  return { ok: true, added: items.length };
}

/** 착수보고·마감일·숙소강의장·준비물품 — '사용하기'로 프로젝트 시트 생성 (기획 13) */
export async function createChecklistFromTemplate(projectId: string, templateId: string): Promise<Result> {
  const gate = await requireProjectTeam(projectId);
  if (!gate.ok) return gate;
  if (!uuid.safeParse(templateId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: template } = await supabase
    .from("checklist_templates").select("id, kind, name").eq("id", templateId).maybeSingle();
  if (!template || !isChecklistKind(template.kind)) return { ok: false, error: "표준시트를 찾을 수 없습니다." };
  if (template.kind === "common" || template.kind === "typed") {
    return { ok: false, error: "공통·유형별은 '불러오기'로 프로젝트 체크리스트에 담습니다." };
  }
  const { data: dup } = await supabase
    .from("project_checklists").select("id").eq("project_id", projectId).eq("template_id", templateId).maybeSingle();
  if (dup) return { ok: false, error: `이미 사용 중인 시트입니다 (${template.name}).` };
  const { data: items } = await supabase
    .from("checklist_template_items")
    .select("phase, category, subcategory, title, offset_days, quantity, note, sort_order")
    .eq("template_id", template.id).order("sort_order", { ascending: true });
  const dday = await projectDday(supabase, projectId);
  const { data: created, error } = await supabase
    .from("project_checklists")
    .insert({
      tenant_id: gate.actor.tenantId, project_id: projectId, kind: template.kind, template_id: template.id,
      name: template.name, dday_date: dday, created_by: gate.actor.userId, updated_by: gate.actor.userId,
    })
    .select("id").single();
  if (error || !created) return { ok: false, error: SYSTEM_FAIL };
  const insErr = await insertItemsFromTemplate(supabase, gate.actor.tenantId, created.id, projectId, items ?? [], 0, gate.actor.userId);
  if (insErr) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "project", action: "checklist.create", checklistId: created.id, projectId,
    after: `${template.name} 사용하기 · ${items?.length ?? 0}개 항목`,
  });
  revalidate();
  return { ok: true };
}

export async function deleteProjectChecklist(checklistId: string): Promise<Result> {
  if (!uuid.safeParse(checklistId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: c } = await supabase
    .from("project_checklists").select("id, project_id, name").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다." };
  const gate = await requireProjectTeam(c.project_id);
  if (!gate.ok) return gate;
  const { error } = await supabase.from("project_checklists").delete().eq("id", checklistId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, { scope: "project", action: "checklist.delete", projectId: c.project_id, before: c.name });
  revalidate();
  return { ok: true };
}

export async function updateChecklistDday(checklistId: string, dday: string | null): Promise<Result> {
  if (!uuid.safeParse(checklistId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (dday !== null && !isoDate.safeParse(dday).success) return { ok: false, error: "D-Day 날짜를 확인하세요." };
  const supabase = createClient();
  const { data: c } = await supabase
    .from("project_checklists").select("id, project_id, dday_date").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다." };
  const gate = await requireProjectTeam(c.project_id);
  if (!gate.ok) return gate;
  const { error } = await supabase
    .from("project_checklists").update({ dday_date: dday, updated_by: gate.actor.userId }).eq("id", checklistId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "project", action: "dday.update", checklistId, projectId: c.project_id,
    field: "D-Day", before: c.dday_date, after: dday,
  });
  revalidate();
  return { ok: true };
}

export async function addChecklistItem(
  checklistId: string,
  afterItemId: string | null,
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!uuid.safeParse(checklistId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const t = title.trim();
  if (!t || t.length > 500) return { ok: false, error: "내용을 1~500자로 입력하세요." };
  const supabase = createClient();
  const { data: c } = await supabase
    .from("project_checklists").select("id, project_id").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다." };
  const gate = await requireProjectTeam(c.project_id);
  if (!gate.ok) return gate;
  // 새 항목은 앞 항목의 시기·분류를 이어받는다 — 표 중간에 끼워 넣는 게 대부분이다
  const { data: prev } = afterItemId
    ? await supabase.from("project_checklist_items").select("phase, category, subcategory").eq("id", afterItemId).maybeSingle()
    : { data: null };
  const sortOrder = await nextSortOrder(supabase, "project_checklist_items", "checklist_id", checklistId, afterItemId);
  const { data, error } = await supabase
    .from("project_checklist_items")
    .insert({
      tenant_id: gate.actor.tenantId, checklist_id: checklistId, project_id: c.project_id, sort_order: sortOrder,
      phase: prev?.phase ?? null, category: prev?.category ?? null, subcategory: prev?.subcategory ?? null,
      title: t, created_by: gate.actor.userId, updated_by: gate.actor.userId,
    })
    .select("id").single();
  if (error || !data) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, { scope: "project", action: "item.add", checklistId, projectId: c.project_id, itemId: data.id, itemTitle: t, after: t });
  revalidate();
  return { ok: true, id: data.id };
}

const itemPatchSchema = z.object({
  phase: z.string().max(40).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  subcategory: z.string().max(80).nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  offsetDays: z.number().int().min(-365).max(365).nullable().optional(),
  quantity: z.string().max(80).nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  completedOn: isoDate.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  memo: z.string().max(4000).nullable().optional(),
  check1: z.string().max(500).nullable().optional(),
  check2: z.string().max(500).nullable().optional(),
  decision: z.string().max(2000).nullable().optional(),
  applicable: z.string().max(200).nullable().optional(),
});
export type ChecklistItemPatch = z.infer<typeof itemPatchSchema>;

const ITEM_COLUMNS: Record<keyof ChecklistItemPatch, string> = {
  phase: "phase", category: "category", subcategory: "subcategory", title: "title", offsetDays: "offset_days",
  quantity: "quantity", assigneeUserId: "assignee_user_id", completedOn: "completed_on", note: "note",
  memo: "memo", check1: "check1", check2: "check2", decision: "decision", applicable: "applicable",
};
const ITEM_LABELS: Record<keyof ChecklistItemPatch, string> = {
  phase: "시기", category: "구분", subcategory: "세부 분류", title: "내용", offsetDays: "권장 마감일",
  quantity: "수량", assigneeUserId: "담당", completedOn: "완료일", note: "참고사항", memo: "메모",
  check1: "1차 확인", check2: "최종 확인", decision: "결정·점검 사항", applicable: "해당사항",
};

/** 항목 기입 — 마감일 계획은 setPlannedDue로 (변경 사유 규칙이 있다) */
export async function updateChecklistItem(itemId: string, patch: ChecklistItemPatch): Promise<Result> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const parsed = itemPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_checklist_items")
    .select("checklist_id, project_id, title, phase, category, subcategory, offset_days, quantity, assignee_user_id, completed_on, note, memo, check1, check2, decision, applicable")
    .eq("id", itemId).maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const gate = await requireProjectTeam(before.project_id);
  if (!gate.ok) return gate;
  const update: TablesUpdate<"project_checklist_items"> = { updated_by: gate.actor.userId };
  const changes: { field: keyof ChecklistItemPatch; before: string | null; after: string | null }[] = [];
  for (const key of Object.keys(parsed.data) as (keyof ChecklistItemPatch)[]) {
    const v = parsed.data[key];
    if (v === undefined) continue;
    const next = typeof v === "string" ? v.trim() || null : v;
    const col = ITEM_COLUMNS[key];
    const prev = before[col as keyof typeof before] as string | number | null;
    if (String(prev ?? "") === String(next ?? "")) continue;
    (update as Record<string, string | number | null>)[col] = next;
    changes.push({ field: key, before: prev === null ? null : String(prev), after: next === null ? null : String(next) });
  }
  if (changes.length === 0) return { ok: true };
  if (update.title === null) return { ok: false, error: "내용을 입력하세요." };
  // 담당 이름을 로그에 남긴다 — id만 있으면 이력에서 누구인지 알 수 없다
  const assigneeChange = changes.find((c) => c.field === "assigneeUserId");
  if (assigneeChange) {
    const ids = [assigneeChange.before, assigneeChange.after].filter((v): v is string => Boolean(v));
    const { data: names } = ids.length ? await supabase.from("users").select("id, name").in("id", ids) : { data: [] };
    const byId = new Map((names ?? []).map((u) => [u.id, u.name]));
    assigneeChange.before = assigneeChange.before ? (byId.get(assigneeChange.before) ?? assigneeChange.before) : null;
    assigneeChange.after = assigneeChange.after ? (byId.get(assigneeChange.after) ?? assigneeChange.after) : null;
  }
  // 담당은 자사 재직자만 — RLS로 보이는 users에 있어야 한다 (리뷰 LOW)
  if (typeof update.assignee_user_id === "string") {
    const { data: assignee } = await supabase
      .from("users").select("id").eq("id", update.assignee_user_id).maybeSingle();
    if (!assignee) return { ok: false, error: "담당자를 찾을 수 없습니다. 목록에서 다시 선택하세요." };
  }
  const { error } = await supabase.from("project_checklist_items").update(update).eq("id", itemId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  for (const c of changes) {
    await logChecklist(gate.actor, {
      scope: "project", action: "item.update", checklistId: before.checklist_id, projectId: before.project_id,
      itemId, itemTitle: before.title, field: ITEM_LABELS[c.field], before: c.before, after: c.after,
    });
  }
  revalidate();
  return { ok: true };
}

export async function deleteChecklistItem(itemId: string): Promise<Result> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const supabase = createClient();
  const { data: before } = await supabase
    .from("project_checklist_items").select("checklist_id, project_id, title").eq("id", itemId).maybeSingle();
  if (!before) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const gate = await requireProjectTeam(before.project_id);
  if (!gate.ok) return gate;
  const { error } = await supabase.from("project_checklist_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, { scope: "project", action: "item.delete", checklistId: before.checklist_id, projectId: before.project_id, itemId, itemTitle: before.title, before: before.title });
  revalidate();
  return { ok: true };
}

const groupValuesSchema = z.object({
  phase: z.string().max(40).nullable(),
  category: z.string().max(80).nullable(),
  subcategory: z.string().max(80).nullable(),
});
const adoptSchema = z.object({ itemIds: z.array(uuid).min(1).max(500), values: groupValuesSchema });
export type GroupAdopt = z.infer<typeof adoptSchema>;

/**
 * 순서 저장 + (다른 분류 묶음에 놓았으면) 그 묶음의 시기·구분·세부 분류를 이어받는다
 * (기획 지시 2026-09-06 — 카테고리 묶음 이동).
 */
export async function reorderChecklistItems(
  checklistId: string,
  orderedIds: string[],
  adopt?: GroupAdopt | null
): Promise<Result> {
  if (!uuid.safeParse(checklistId).success || !z.array(uuid).max(2000).safeParse(orderedIds).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다." };
  }
  const parsedAdopt = adopt ? adoptSchema.safeParse(adopt) : null;
  if (parsedAdopt && !parsedAdopt.success) return { ok: false, error: "분류 값을 확인하세요." };
  const supabase = createClient();
  const { data: c } = await supabase
    .from("project_checklists").select("id, project_id, kind").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다." };
  const gate = await requireProjectTeam(c.project_id);
  if (!gate.ok) return gate;
  // 분류 이어받기를 먼저 — 실패하면 순서도 저장하지 않는다 (리뷰 L1)
  let adopted = false;
  if (parsedAdopt?.success) {
    const fields = isChecklistKind(c.kind) ? GROUP_FIELDS[c.kind] : [];
    const { itemIds, values } = parsedAdopt.data;
    const update: TablesUpdate<"project_checklist_items"> = { updated_by: gate.actor.userId };
    for (const f of fields) update[f] = values[f]?.trim() || null;
    const { data: moved } = await supabase
      .from("project_checklist_items")
      .select("id, title, phase, category, subcategory").in("id", itemIds).eq("checklist_id", checklistId);
    if (fields.length > 0 && moved && moved.length > 0) {
      const { error } = await supabase
        .from("project_checklist_items").update(update).in("id", moved.map((m) => m.id)).eq("checklist_id", checklistId);
      if (error) return { ok: false, error: SYSTEM_FAIL };
      const label = fields.map((f) => update[f] ?? "(미분류)").join(" › ");
      for (const m of moved) {
        await logChecklist(gate.actor, {
          scope: "project", action: "item.move", checklistId, projectId: c.project_id,
          itemId: m.id, itemTitle: m.title, field: "분류",
          before: fields.map((f) => m[f] ?? "(미분류)").join(" › "), after: label,
        });
      }
      adopted = true;
    }
  }
  await applyOrder(supabase, "project_checklist_items", "checklist_id", checklistId, orderedIds, gate.actor.userId);
  // 분류 이동 로그가 이미 남았으면 순서 로그는 겹치므로 생략 (리뷰 M4)
  if (!adopted) {
    await logChecklist(gate.actor, { scope: "project", action: "item.reorder", checklistId, projectId: c.project_id, after: `${orderedIds.length}개 항목 순서 변경` });
  }
  revalidate();
  return { ok: true };
}

/** 묶음 머리행에서 분류 이름 변경 — 묶음의 모든 항목에 적용 (기획 지시 2026-09-06) */
export async function renameChecklistGroup(
  checklistId: string,
  itemIds: string[],
  field: GroupField,
  value: string | null
): Promise<Result> {
  if (!uuid.safeParse(checklistId).success || !z.array(uuid).min(1).max(500).safeParse(itemIds).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다." };
  }
  if (field !== "phase" && field !== "category" && field !== "subcategory") {
    return { ok: false, error: "분류 열을 확인하세요." };
  }
  const next = value?.trim() || null;
  if (next && next.length > (field === "phase" ? 40 : 80)) return { ok: false, error: "분류 이름이 너무 깁니다." };
  const supabase = createClient();
  const { data: c } = await supabase
    .from("project_checklists").select("id, project_id").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다." };
  const gate = await requireProjectTeam(c.project_id);
  if (!gate.ok) return gate;
  const { data: rows } = await supabase
    .from("project_checklist_items").select("id, phase, category, subcategory").in("id", itemIds).eq("checklist_id", checklistId);
  if (!rows || rows.length === 0) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const before = rows[0]![field] ?? null;
  if (rows.every((r) => (r[field] ?? "") === (next ?? ""))) return { ok: true };
  const update: TablesUpdate<"project_checklist_items"> = { updated_by: gate.actor.userId };
  update[field] = next;
  const { error } = await supabase
    .from("project_checklist_items").update(update).in("id", rows.map((r) => r.id)).eq("checklist_id", checklistId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  await logChecklist(gate.actor, {
    scope: "project", action: "group.rename", checklistId, projectId: c.project_id,
    itemTitle: `${rows.length}개 항목`, field: GROUP_FIELD_LABELS[field], before, after: next,
  });
  revalidate();
  return { ok: true };
}

export type PlannedDueResult =
  | { ok: true }
  | { ok: false; error: string; needsReason?: true };

/**
 * 마감일 계획 (기획 04·06): 정한 당일에는 자유 수정, 다음날부터는 변경 일자·사유
 * 팝업이 필수. 사유는 참고사항 아래 변경 이력으로 기록된다 (기획 07).
 */
export async function setPlannedDue(
  itemId: string,
  plannedDue: string | null,
  change: { changedOn: string; reason: string } | null
): Promise<PlannedDueResult> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (plannedDue !== null && !isoDate.safeParse(plannedDue).success) return { ok: false, error: "마감일 계획 날짜를 확인하세요." };
  const supabase = createClient();
  const { data: item } = await supabase
    .from("project_checklist_items")
    .select("checklist_id, project_id, title, planned_due_on, planned_due_set_on")
    .eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, error: "항목을 찾을 수 없습니다." };
  const gate = await requireProjectTeam(item.project_id);
  if (!gate.ok) return gate;
  if ((item.planned_due_on ?? "") === (plannedDue ?? "")) return { ok: true };
  const today = kstToday();
  const lockedByDate = Boolean(item.planned_due_on) && Boolean(item.planned_due_set_on) && item.planned_due_set_on !== today;
  if (lockedByDate && !change) {
    return {
      ok: false,
      needsReason: true,
      error: "정한 다음날부터의 마감일 변경은 변경 일자와 사유를 적어야 합니다 (규칙).",
    };
  }
  if (change) {
    const reason = change.reason.trim();
    if (!reason || reason.length > 1000) return { ok: false, error: "변경 사유를 1~1000자로 입력하세요." };
    if (!isoDate.safeParse(change.changedOn).success) return { ok: false, error: "변경 일자를 확인하세요." };
  }
  const { error } = await supabase
    .from("project_checklist_items")
    .update({ planned_due_on: plannedDue, planned_due_set_on: today, planned_due_set_by: gate.actor.userId, updated_by: gate.actor.userId })
    .eq("id", itemId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  if (change) {
    await supabase.from("project_checklist_due_changes").insert({
      tenant_id: gate.actor.tenantId, item_id: itemId, project_id: item.project_id,
      changed_on: change.changedOn, prev_due_on: item.planned_due_on, new_due_on: plannedDue,
      reason: change.reason.trim(), changed_by: gate.actor.userId, changed_by_grade: gate.actor.grade,
    });
  }
  await logChecklist(gate.actor, {
    scope: "project", action: change ? "due.change" : "item.update", checklistId: item.checklist_id, projectId: item.project_id,
    itemId, itemTitle: item.title, field: "마감일 계획", before: item.planned_due_on, after: plannedDue
      ? `${plannedDue}${change ? ` (변경 일자 ${change.changedOn}: ${change.reason.trim()})` : ""}`
      : null,
  });
  revalidate();
  return { ok: true };
}

/** 변경 사유 수정 — 상급자가 열어 본 뒤에는 그 상급자만 (기획 07) */
export async function updateDueChangeReason(changeId: string, reason: string): Promise<Result> {
  if (!uuid.safeParse(changeId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 1000) return { ok: false, error: "변경 사유를 1~1000자로 입력하세요." };
  const supabase = createClient();
  const { data: ch } = await supabase
    .from("project_checklist_due_changes")
    .select("id, item_id, project_id, reason, changed_by, opened_by")
    .eq("id", changeId).maybeSingle();
  if (!ch) return { ok: false, error: "변경 이력을 찾을 수 없습니다." };
  const gate = await requireProjectTeam(ch.project_id);
  if (!gate.ok) return gate;
  const me = gate.actor.userId;
  if (ch.opened_by ? ch.opened_by !== me : ch.changed_by !== me) {
    return {
      ok: false,
      error: ch.opened_by
        ? "상급자가 확인한 변경 사유는 그 상급자만 수정할 수 있습니다 (규칙)."
        : "변경 사유는 작성자 본인만 수정할 수 있습니다 (규칙).",
    };
  }
  const { error } = await supabase
    .from("project_checklist_due_changes").update({ reason: trimmed }).eq("id", changeId);
  if (error) return { ok: false, error: SYSTEM_FAIL };
  const { data: item } = await supabase
    .from("project_checklist_items").select("checklist_id, title").eq("id", ch.item_id).maybeSingle();
  await logChecklist(gate.actor, {
    scope: "project", action: "due.reason_update", checklistId: item?.checklist_id ?? null, projectId: ch.project_id,
    itemId: ch.item_id, itemTitle: item?.title ?? null, field: "변경 사유", before: ch.reason, after: trimmed,
  });
  revalidate();
  return { ok: true };
}

/**
 * 상급자 열람 표시 — 이 프로젝트의 변경 사유 중 아직 열리지 않은 것을, 작성자보다
 * 직급이 높은 열람자가 처음 볼 때 '오픈'으로 기록한다. 화면이 열릴 때 호출된다.
 */
export async function acknowledgeDueChanges(
  projectId: string
): Promise<{ ok: true; opened: number } | { ok: false; error: string }> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const myGrade = isUserGrade(gate.actor.grade) ? gate.actor.grade : null;
  if (!myGrade) return { ok: true, opened: 0 };
  const supabase = createClient();
  const { data: open } = await supabase
    .from("project_checklist_due_changes")
    .select("id, changed_by, changed_by_grade")
    .eq("project_id", projectId).is("opened_by", null);
  const targets = (open ?? []).filter(
    (c) => c.changed_by !== gate.actor.userId && isUserGrade(c.changed_by_grade) && gradeRank(myGrade) > gradeRank(c.changed_by_grade)
  );
  if (targets.length === 0) return { ok: true, opened: 0 };
  const { data: updated } = await supabase
    .from("project_checklist_due_changes")
    .update({ opened_by: gate.actor.userId, opened_at: new Date().toISOString() })
    .in("id", targets.map((t) => t.id)).is("opened_by", null)
    .select("id");
  return { ok: true, opened: updated?.length ?? 0 };
}

function toLogRows(
  data: { id: string; created_at: string; actor_name: string | null; action: string; item_title: string | null; field: string | null; before_value: string | null; after_value: string | null }[] | null
): ChecklistLogRow[] {
  return (data ?? []).map((r) => ({
    id: r.id, at: r.created_at, actorName: r.actor_name, action: r.action,
    itemTitle: r.item_title, field: r.field, before: r.before_value, after: r.after_value,
  }));
}

export async function getProjectChecklistLogs(
  checklistId: string
): Promise<{ ok: true; rows: ChecklistLogRow[] } | { ok: false; error: string }> {
  if (!uuid.safeParse(checklistId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const supabase = createClient();
  // 체크리스트가 열람 범위 안인지 RLS로 먼저 확인 (리뷰 M3)
  const { data: c } = await supabase
    .from("project_checklists").select("id").eq("id", checklistId).maybeSingle();
  if (!c) return { ok: false, error: "체크리스트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  const { data } = await supabase
    .from("checklist_logs")
    .select("id, created_at, actor_name, action, item_title, field, before_value, after_value")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: false })
    .limit(300);
  return { ok: true, rows: toLogRows(data) };
}

/** 프로젝트 전체 로그 — 삭제된 시트의 기록까지 (기획 15, 리뷰 M6) */
export async function getProjectAllChecklistLogs(
  projectId: string
): Promise<{ ok: true; rows: ChecklistLogRow[] } | { ok: false; error: string }> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "대상을 확인할 수 없습니다." };
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const supabase = createClient();
  const { data: p } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!p) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  const { data } = await supabase
    .from("checklist_logs")
    .select("id, created_at, actor_name, action, item_title, field, before_value, after_value")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(500);
  return { ok: true, rows: toLogRows(data) };
}

