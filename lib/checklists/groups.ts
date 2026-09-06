import { CHECKLIST_COLUMNS, type ChecklistKind } from "./kinds";

/**
 * 체크리스트 분류 묶음 (기획 지시 2026-09-06).
 * 시기·구분·세부 분류처럼 값이 반복되는 열은 항목마다 칸으로 두지 않고,
 * 같은 값이 이어지는 구간을 한 묶음으로 보여 준다. 묶음 머리행에서 이름을
 * 고치면 묶음 전체에 적용되고, 묶음 손잡이를 끌면 항목이 통째로 움직인다.
 * 표준시트와 프로젝트 시트가 같은 계산을 쓴다 (클라이언트·서버 공용, 순수 함수).
 */

export type GroupField = "phase" | "category" | "subcategory";

export const GROUP_FIELD_LABELS: Record<GroupField, string> = {
  phase: "시기",
  category: "구분",
  subcategory: "세부 분류",
};

/** 종류별 묶음 열 라벨 — 시트 열 이름과 맞춘다 (착수보고회는 '사업 분류') */
export function groupFieldLabel(kind: ChecklistKind, field: GroupField): string {
  return CHECKLIST_COLUMNS[kind].find((c) => c.key === field)?.label ?? GROUP_FIELD_LABELS[field];
}

/** 종류별 묶음 열 — 앞이 큰 분류. 비어 있으면 묶지 않는다 */
export const GROUP_FIELDS: Record<ChecklistKind, GroupField[]> = {
  common: ["phase", "subcategory"],
  typed: ["phase", "category", "subcategory"],
  kickoff: ["category"],
  deadline: [],
  venue: ["category"],
  supplies: ["category"],
};

export type GroupValues = Record<GroupField, string | null>;
export type GroupableItem = { id: string } & GroupValues;

export type Shade = { row: string; header: string };

/**
 * 묶음 음영 — 마지막 분류(세부 분류·구분) 값으로 정해진다. 같은 값이면 시트
 * 어디에 있어도 같은 색이라 눈으로 바로 찾는다. 값이 없으면 회색.
 */
const SHADES: Shade[] = [
  { row: "bg-sky-50", header: "bg-sky-100" },
  { row: "bg-amber-50", header: "bg-amber-100" },
  { row: "bg-emerald-50", header: "bg-emerald-100" },
  { row: "bg-violet-50", header: "bg-violet-100" },
  { row: "bg-rose-50", header: "bg-rose-100" },
  { row: "bg-teal-50", header: "bg-teal-100" },
  { row: "bg-orange-50", header: "bg-orange-100" },
  { row: "bg-indigo-50", header: "bg-indigo-100" },
  { row: "bg-lime-50", header: "bg-lime-100" },
  { row: "bg-fuchsia-50", header: "bg-fuchsia-100" },
];
const NO_SHADE: Shade = { row: "", header: "bg-slate-100" };
const UNTAGGED_SHADE: Shade = { row: "bg-slate-50", header: "bg-slate-200" };

export function shadeFor(label: string | null | undefined, fields: GroupField[]): Shade {
  if (fields.length === 0) return NO_SHADE;
  if (!label) return UNTAGGED_SHADE;
  let h = 5381;
  for (let i = 0; i < label.length; i += 1) h = ((h << 5) + h + label.charCodeAt(i)) | 0;
  return SHADES[Math.abs(h) % SHADES.length]!;
}

export function groupValuesOf(item: GroupValues, fields: GroupField[]): GroupValues {
  return {
    phase: fields.includes("phase") ? (item.phase?.trim() || null) : null,
    category: fields.includes("category") ? (item.category?.trim() || null) : null,
    subcategory: fields.includes("subcategory") ? (item.subcategory?.trim() || null) : null,
  };
}

export function groupKeyOf(values: GroupValues, fields: GroupField[]): string {
  return fields.map((f) => values[f] ?? "").join("");
}

export function sameGroup(a: GroupValues, b: GroupValues, fields: GroupField[]): boolean {
  return groupKeyOf(groupValuesOf(a, fields), fields) === groupKeyOf(groupValuesOf(b, fields), fields);
}

export type ItemGroup = {
  /** 분류 값 조합 + 등장 순번 — 같은 분류가 떨어져 두 번 나와도 구분된다 */
  key: string;
  /** 첫 항목 id — React key용. 이름을 바꾸거나 옮겨도 바뀌지 않는다 (리뷰 M3) */
  anchorId: string;
  values: GroupValues;
  ids: string[];
  shade: Shade;
};

/** 정렬 순서를 보존한 채 같은 분류가 이어지는 구간을 묶는다 */
export function buildGroups<T extends GroupableItem>(
  ids: string[],
  byId: Map<string, T>,
  fields: GroupField[]
): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const seen = new Map<string, number>();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const values = groupValuesOf(item, fields);
    const base = groupKeyOf(values, fields);
    const last = groups[groups.length - 1];
    if (last && groupKeyOf(last.values, fields) === base) {
      last.ids.push(id);
      continue;
    }
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const shadeLabel = fields.length ? values[fields[fields.length - 1]!] : null;
    groups.push({ key: `${base}#${n}`, anchorId: id, values, ids: [id], shade: shadeFor(shadeLabel, fields) });
  }
  return groups;
}

/** 항목 하나를 beforeId 앞으로 (null이면 맨 뒤로) */
export function moveItemBefore(ids: string[], dragId: string, beforeId: string | null): string[] {
  if (dragId === beforeId) return ids;
  const next = ids.filter((id) => id !== dragId);
  if (beforeId === null) {
    next.push(dragId);
    return next;
  }
  const idx = next.indexOf(beforeId);
  if (idx < 0) return ids;
  next.splice(idx, 0, dragId);
  return next;
}

/** 묶음(연속 구간)을 통째로 beforeId 앞으로 (null이면 맨 뒤로) */
export function moveGroupBefore(ids: string[], groupIds: string[], beforeId: string | null): string[] {
  const moving = new Set(groupIds);
  if (beforeId !== null && moving.has(beforeId)) return ids;
  const rest = ids.filter((id) => !moving.has(id));
  const block = ids.filter((id) => moving.has(id));
  if (beforeId === null) return [...rest, ...block];
  const idx = rest.indexOf(beforeId);
  if (idx < 0) return ids;
  rest.splice(idx, 0, ...block);
  return rest;
}

/** 묶음 머리행 표시용 — "행사 전 › 캠프 › 숙박" */
export function groupTitle(values: GroupValues, fields: GroupField[]): string {
  return fields.map((f) => values[f] ?? "(미분류)").join(" › ");
}
