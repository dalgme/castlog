"use client";

import { GripVertical, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { type GroupField, type GroupValues, type Shade } from "@/lib/checklists/groups";

import { EditableText } from "./editable-cell";

/**
 * 분류 묶음 머리행 — 시기·구분·세부 분류 값을 한 줄에 보여 주고, 여기서 고치면
 * 묶음 전체 항목에 적용된다. 손잡이를 끌면 묶음이 통째로 움직이고, 다른 항목을
 * 여기에 놓으면 그 항목이 이 분류로 들어온다 (기획 지시 2026-09-06).
 */
export function GroupHeaderRow({
  fields,
  labels,
  values,
  count,
  colSpan,
  canEdit,
  shade,
  dragging,
  pending,
  onDragStart,
  onDragEnd,
  onDrop,
  onRename,
  onAdd,
}: {
  fields: GroupField[];
  labels: Record<GroupField, string>;
  values: GroupValues;
  count: number;
  colSpan: number;
  canEdit: boolean;
  shade: Shade;
  dragging: boolean;
  pending: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRename: (field: GroupField, value: string | null) => void;
  onAdd: () => void;
}) {
  return (
    <tr
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn("border-t-2 border-white", shade.header, dragging && "opacity-50")}
    >
      <td
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", `group:${fields.map((f) => values[f] ?? "").join("/")}`);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className={cn("py-1 text-muted-foreground", canEdit && "cursor-grab")}
        title={canEdit ? "끌어서 분류 전체 이동" : undefined}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </td>
      <td colSpan={colSpan - 1} className="py-1 pr-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {fields.map((f, i) => (
            <span key={f} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">›</span>}
              <span className="text-[10px] text-muted-foreground">{labels[f]}</span>
              <span className="inline-block min-w-[6rem] max-w-[14rem]">
                <EditableText
                  value={values[f]}
                  disabled={!canEdit}
                  placeholder="(미분류)"
                  inputClassName="font-semibold"
                  className="font-semibold"
                  onSave={(v) => onRename(f, v)}
                />
              </span>
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">{count}개</span>
          {canEdit && (
            <button
              type="button"
              title="이 분류에 항목 추가"
              className="rounded p-0.5 text-muted-foreground hover:text-brand"
              disabled={pending}
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** 표 끝 놓기 구역 — 끌던 항목·묶음을 맨 아래로 */
export function DropEndRow({
  colSpan,
  active,
  onDrop,
}: {
  colSpan: number;
  active: boolean;
  onDrop: () => void;
}) {
  return (
    <tr
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <td
        colSpan={colSpan}
        className={cn(
          "h-7 text-center text-[10px] text-muted-foreground transition-colors",
          active && "border border-dashed border-brand/60 bg-brand/5"
        )}
      >
        {active ? "여기에 놓으면 맨 아래로" : ""}
      </td>
    </tr>
  );
}
