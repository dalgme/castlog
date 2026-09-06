"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Plus, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CHECKLIST_COLUMNS,
  CHECKLIST_KIND_LABELS,
  type ChecklistKind,
} from "@/lib/checklists/kinds";
import {
  GROUP_FIELDS,
  buildGroups,
  groupFieldLabel,
  groupValuesOf,
  moveGroupBefore,
  moveItemBefore,
  sameGroup,
  type GroupField,
  type GroupValues,
  type ItemGroup,
} from "@/lib/checklists/groups";
import { ChecklistLogsDialog } from "@/components/checklists/checklist-logs-dialog";
import { EditableText } from "@/components/checklists/editable-cell";
import { DropEndRow, GroupHeaderRow } from "@/components/checklists/group-header-row";

import {
  addTemplateItem,
  createTemplate,
  deleteTemplate,
  deleteTemplateItem,
  getTemplateLogs,
  renameTemplate,
  renameTemplateGroup,
  reorderTemplateItems,
  updateTemplateItem,
  type TemplateItemPatch,
} from "./actions";

export type TemplateItemView = {
  id: string;
  phase: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  offsetDays: number | null;
  quantity: string | null;
  note: string | null;
};

export type TemplateView = {
  id: string;
  kind: ChecklistKind;
  name: string;
  updatedAt: string;
  items: TemplateItemView[];
};

/**
 * 표준시트 편집 (기획 01·11·13·14) — 누구나 항목을 고치고, 끌어서 순서를 바꾼다.
 * 저장은 칸을 벗어날 때 바로. 모든 변경은 로그로 남는다.
 */
export function TemplateEditor({
  kind,
  templates,
}: {
  kind: ChecklistKind;
  templates: TemplateView[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ variant: "destructive", description: r.error ?? "실패했습니다." });
      else {
        if (ok) toast({ description: ok });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} run={run} pending={pending} />
      ))}
      {(kind === "supplies" || templates.length === 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`새 ${CHECKLIST_KIND_LABELS[kind]} 시트 이름 (예: 팀빌딩 - 마시멜로우)`}
            className="max-w-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !newName.trim()}
            onClick={() =>
              run(async () => {
                const r = await createTemplate(kind, newName);
                if (r.ok) setNewName("");
                return r;
              }, "시트를 만들었습니다.")
            }
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> 시트 추가
          </Button>
        </div>
      )}
    </div>
  );
}

type Drag = { kind: "item"; id: string } | { kind: "group"; key: string; ids: string[] };

function TemplateCard({
  template,
  run,
  pending,
}: {
  template: TemplateView;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
  pending: boolean;
}) {
  const groupFields = GROUP_FIELDS[template.kind];
  // 분류 열은 묶음 머리행에 보이므로 항목 행에서는 뺀다
  const columns = CHECKLIST_COLUMNS[template.kind].filter(
    (c) => c.template && !(groupFields as string[]).includes(c.key)
  );
  const groupLabels = Object.fromEntries(
    (["phase", "category", "subcategory"] as GroupField[]).map((f) => [f, groupFieldLabel(template.kind, f)])
  ) as Record<GroupField, string>;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, GroupValues>>({});
  const [openClassify, setOpenClassify] = useState<Record<string, boolean>>({});
  const serverIds = template.items.map((i) => i.id);
  const serverKey = serverIds.join(",");
  useEffect(() => {
    setOrder(null);
    setOverrides({});
  }, [serverKey]);
  const ids = order ?? serverIds;
  const byId = new Map(
    template.items.map((i) => [i.id, overrides[i.id] ? { ...i, ...overrides[i.id] } : i])
  );
  const groups = buildGroups(ids, byId, groupFields);
  const span = columns.length + 3;
  const deletable = template.kind !== "common" && template.kind !== "typed";

  function commitOrder(next: string[], adopt: { itemIds: string[]; values: GroupValues } | null) {
    setDrag(null);
    if (adopt === null && next.join(",") === ids.join(",")) return;
    setOrder(next);
    if (adopt) {
      setOverrides((o) => ({ ...o, ...Object.fromEntries(adopt.itemIds.map((id) => [id, adopt.values])) }));
    }
    run(async () => {
      const r = await reorderTemplateItems(template.id, next, adopt);
      if (!r.ok) {
        setOrder(null);
        setOverrides({});
      }
      return r;
    });
  }

  function dropOnItem(targetId: string) {
    if (!drag) return;
    const target = byId.get(targetId);
    if (!target) return;
    if (drag.kind === "item") {
      if (drag.id === targetId) return setDrag(null);
      const me = byId.get(drag.id);
      const adopt = me && !sameGroup(me, target, groupFields)
        ? { itemIds: [drag.id], values: groupValuesOf(target, groupFields) }
        : null;
      return commitOrder(moveItemBefore(ids, drag.id, targetId), adopt);
    }
    const targetGroup = groups.find((g) => g.ids.includes(targetId));
    if (!targetGroup || targetGroup.key === drag.key) return setDrag(null);
    commitOrder(moveGroupBefore(ids, drag.ids, targetGroup.ids[0]!), null);
  }

  function dropOnGroup(g: ItemGroup) {
    if (!drag) return;
    if (drag.kind === "item") {
      const me = byId.get(drag.id);
      const adopt = me && !sameGroup(me, g.values, groupFields) ? { itemIds: [drag.id], values: g.values } : null;
      return commitOrder(moveItemBefore(ids, drag.id, g.ids[0]!), adopt);
    }
    if (drag.key === g.key) return setDrag(null);
    commitOrder(moveGroupBefore(ids, drag.ids, g.ids[0]!), null);
  }

  function dropAtEnd() {
    if (!drag) return;
    if (drag.kind === "item") return commitOrder(moveItemBefore(ids, drag.id, null), null);
    commitOrder(moveGroupBefore(ids, drag.ids, null), null);
  }

  function patchOf(item: TemplateItemView, key: string, value: string | null): TemplateItemPatch {
    if (key === "offsetDays") {
      const n = value === null ? null : Number(value);
      return { offsetDays: value === null || Number.isNaN(n) ? null : n };
    }
    if (key === "title") return { title: value ?? "" };
    return { [key]: value } as TemplateItemPatch;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm">
          <EditableText
            value={template.name}
            onSave={(v) => {
              if (v) run(() => renameTemplate(template.id, v));
            }}
            inputClassName="font-semibold"
          />
        </CardTitle>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">{template.items.length}개 항목</span>
          <ChecklistLogsDialog title={template.name} load={() => getTemplateLogs(template.id)} />
          {deletable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`'${template.name}' 시트를 삭제할까요? 이미 프로젝트에 불러간 사본은 남습니다.`)) {
                  run(() => deleteTemplate(template.id), "삭제했습니다.");
                }
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> 시트 삭제
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {groupFields.length > 0 && (
          <p className="mb-2 text-[11px] text-muted-foreground">
            {groupFields.map((f) => groupLabels[f]).join(" › ")} 묶음별로 음영이 다릅니다. 묶음 머리행에서
            이름을 고치면 묶음 전체에 적용되고, 머리행 손잡이를 끌면 묶음이 통째로 움직입니다. 항목을 다른 묶음에
            놓으면 그 분류로 들어갑니다. 항목 하나만 다른 분류로 두려면 행 끝의 분류(태그) 단추를 누르세요.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="w-6" />
                <th className="w-8 py-1 font-medium">No</th>
                {columns.map((c) => (
                  <th key={c.key} className={cn("py-1 pr-2 font-medium", c.width)}>
                    {c.label}
                  </th>
                ))}
                <th className="w-14" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(() => {
                let idx = 0;
                return groups.map((g) => (
                  <Fragment key={g.anchorId}>
                    {groupFields.length > 0 && (
                      <GroupHeaderRow
                        fields={groupFields}
                        labels={groupLabels}
                        values={g.values}
                        count={g.ids.length}
                        colSpan={span}
                        canEdit
                        shade={g.shade}
                        dragging={drag?.kind === "group" && drag.key === g.key}
                        pending={pending}
                        onDragStart={() => setDrag({ kind: "group", key: g.key, ids: g.ids })}
                        onDragEnd={() => setDrag(null)}
                        onDrop={() => dropOnGroup(g)}
                        onRename={(field, value) =>
                          run(() => renameTemplateGroup(template.id, g.ids, field, value), "분류 이름을 바꿨습니다.")
                        }
                        onAdd={() => {
                          const last = byId.get(g.ids[g.ids.length - 1]!);
                          run(() =>
                            addTemplateItem(template.id, last?.id ?? null, {
                              title: "새 항목",
                              phase: g.values.phase,
                              category: g.values.category,
                              subcategory: g.values.subcategory,
                            })
                          );
                        }}
                      />
                    )}
                    {g.ids.map((id) => {
                      const item = byId.get(id);
                      if (!item) return null;
                      const rowIdx = idx;
                      idx += 1;
                      const classifyOpen = openClassify[id] ?? false;
                      return (
                        <Fragment key={id}>
                        <tr
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            dropOnItem(id);
                          }}
                          className={cn(
                            "align-top",
                            g.shade.row,
                            ((drag?.kind === "item" && drag.id === id) ||
                              (drag?.kind === "group" && drag.ids.includes(id))) && "opacity-50"
                          )}
                        >
                          <td
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", id);
                              e.dataTransfer.effectAllowed = "move";
                              setDrag({ kind: "item", id });
                            }}
                            onDragEnd={() => setDrag(null)}
                            className="cursor-grab py-1 text-muted-foreground"
                            title="끌어서 순서 변경"
                          >
                            <GripVertical className="h-4 w-4" aria-hidden />
                          </td>
                          <td className="py-1 tabular-nums text-muted-foreground">{rowIdx + 1}</td>
                          {columns.map((c) => {
                            const raw =
                              c.key === "offsetDays"
                                ? item.offsetDays === null
                                  ? null
                                  : String(item.offsetDays)
                                : (item[c.key as keyof TemplateItemView] as string | null);
                            return (
                              <td key={c.key} className="py-0.5 pr-2">
                                <EditableText
                                  value={raw}
                                  multiline={c.key === "title" || c.key === "note"}
                                  type={c.key === "offsetDays" ? "number" : "text"}
                                  placeholder={c.key === "offsetDays" ? "D±" : ""}
                                  onSave={(v) =>
                                    run(() => updateTemplateItem(item.id, patchOf(item, c.key, v)))
                                  }
                                />
                              </td>
                            );
                          })}
                          <td className="py-0.5 text-right">
                            {groupFields.length > 0 && (
                              <button
                                type="button"
                                title="이 항목만 분류 바꾸기"
                                className={cn("rounded p-1 hover:text-brand", classifyOpen ? "text-brand" : "text-muted-foreground")}
                                onClick={() => setOpenClassify((m) => ({ ...m, [id]: !classifyOpen }))}
                              >
                                <Tag className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            )}
                            <button
                              type="button"
                              title="아래에 항목 추가"
                              className="rounded p-1 text-muted-foreground hover:text-brand"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  addTemplateItem(template.id, item.id, {
                                    title: "새 항목",
                                    phase: item.phase,
                                    category: item.category,
                                    subcategory: item.subcategory,
                                  })
                                )
                              }
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              title="항목 삭제"
                              className="rounded p-1 text-muted-foreground hover:text-red-600"
                              disabled={pending}
                              onClick={() => {
                                if (window.confirm(`'${item.title}' 항목을 삭제할까요?`)) {
                                  run(() => deleteTemplateItem(item.id));
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </td>
                        </tr>
                        {classifyOpen && (
                          <tr className="bg-secondary/30">
                            <td colSpan={span} className="px-8 py-1.5">
                              <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
                                이 항목만 분류 바꾸기 — {item.title}
                                <span className="ml-1 font-normal">(새 이름을 적으면 새 묶음으로 갈라집니다. 비우면 미분류)</span>
                              </p>
                              <div className="flex flex-wrap gap-3">
                                {groupFields.map((f) => (
                                  <label key={f} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    {groupLabels[f]}
                                    <span className="inline-block w-40">
                                      <EditableText
                                        value={item[f]}
                                        placeholder="(미분류)"
                                        onSave={(v) => run(() => updateTemplateItem(item.id, patchOf(item, f, v)))}
                                      />
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ));
              })()}
              {ids.length > 0 && <DropEndRow colSpan={span} active={drag !== null} onDrop={dropAtEnd} />}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => addTemplateItem(template.id, null, { title: "새 항목" }))}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden /> 항목 추가
        </Button>
      </CardContent>
    </Card>
  );
}
