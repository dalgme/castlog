"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, GripVertical, Palette, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  GROUP_COLORS,
  type GroupColorKey,
  type GroupField,
  type GroupValues,
  type Shade,
} from "@/lib/checklists/groups";

import { EditableText } from "./editable-cell";

/** 영역 색상 단추 — 누르면 팔레트가 열리고, 고르면 머리행(진한 색)·항목 행(연한 색)이 함께 바뀐다 */
function ColorPicker({
  current,
  disabled,
  onPick,
}: {
  current: GroupColorKey | null;
  disabled: boolean;
  onPick: (key: GroupColorKey | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cur = GROUP_COLORS.find((c) => c.key === current);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        title="이 영역의 색상 바꾸기"
        aria-label="영역 색상"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 rounded p-0.5 text-muted-foreground hover:text-brand"
      >
        <Palette className="h-3.5 w-3.5" aria-hidden />
        <span className={cn("inline-block h-3 w-3 rounded-sm border border-black/10", cur?.swatch ?? "bg-white")} aria-hidden />
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border bg-white p-2 shadow-lg">
          <span className="mb-1 block text-[10px] text-muted-foreground">영역 색상 — 항목 행은 같은 계열의 연한 색으로</span>
          <span className="grid grid-cols-6 gap-1">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => {
                  onPick(c.key);
                  setOpen(false);
                }}
                className={cn(
                  "h-6 w-6 rounded-sm border border-black/10 transition-transform hover:scale-110",
                  c.swatch,
                  current === c.key && "ring-2 ring-black/60 ring-offset-1"
                )}
              />
            ))}
          </span>
          {current && (
            <button
              type="button"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className="mt-1.5 block text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              자동 색상으로 되돌리기
            </button>
          )}
        </span>
      )}
    </span>
  );
}

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
  onDuplicate,
  onDelete,
  color = null,
  onColor,
}: {
  fields: GroupField[];
  labels: Record<GroupField, string>;
  values: GroupValues;
  count: number;
  colSpan: number;
  canEdit: boolean;
  shade: Shade;
  /** 고른 색상 키 (기획 지시 2026-09-21) — onColor가 없으면 색상 단추를 숨긴다 */
  color?: GroupColorKey | null;
  onColor?: (key: GroupColorKey | null) => void;
  dragging: boolean;
  pending: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRename: (field: GroupField, value: string | null) => void;
  onAdd: () => void;
  /** 영역 복제·삭제 (기획 지시 2026-09-20) — 표준시트에서는 넘기지 않는다 */
  onDuplicate?: () => void;
  onDelete?: () => void;
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
          {canEdit && onColor && <ColorPicker current={color} disabled={pending} onPick={onColor} />}
          {canEdit && (
            <button
              type="button"
              title="이 영역 아래에 새 영역 추가"
              className="rounded p-0.5 text-muted-foreground hover:text-brand"
              disabled={pending}
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {canEdit && onDuplicate && (
            <button
              type="button"
              title="이 영역(같은 색 묶음)을 통째로 복제해 바로 아래에 붙입니다"
              className="rounded p-0.5 text-muted-foreground hover:text-brand"
              disabled={pending}
              onClick={onDuplicate}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {canEdit && onDelete && (
            <button
              type="button"
              title="이 영역의 항목을 모두 삭제합니다"
              className="rounded p-0.5 text-muted-foreground hover:text-red-600"
              disabled={pending}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
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
