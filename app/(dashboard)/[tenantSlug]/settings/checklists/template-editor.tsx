"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Plus, Trash2 } from "lucide-react";

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
import { ChecklistLogsDialog } from "@/components/checklists/checklist-logs-dialog";
import { EditableText } from "@/components/checklists/editable-cell";

import {
  addTemplateItem,
  createTemplate,
  deleteTemplate,
  deleteTemplateItem,
  getTemplateLogs,
  renameTemplate,
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

function TemplateCard({
  template,
  run,
  pending,
}: {
  template: TemplateView;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
  pending: boolean;
}) {
  const columns = CHECKLIST_COLUMNS[template.kind].filter((c) => c.template);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order ?? template.items.map((i) => i.id);
  const byId = new Map(template.items.map((i) => [i.id, i]));
  const deletable = template.kind !== "common" && template.kind !== "typed";

  function patchOf(item: TemplateItemView, key: string, value: string | null): TemplateItemPatch {
    if (key === "offsetDays") {
      const n = value === null ? null : Number(value);
      return { offsetDays: value === null || Number.isNaN(n) ? null : n };
    }
    if (key === "title") return { title: value ?? "" };
    return { [key]: value } as TemplateItemPatch;
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = ids.filter((id) => id !== dragId);
    const idx = next.indexOf(targetId);
    next.splice(idx, 0, dragId);
    setOrder(next);
    setDragId(null);
    run(() => reorderTemplateItems(template.id, next));
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
              {ids.map((id, idx) => {
                const item = byId.get(id);
                if (!item) return null;
                return (
                  <tr
                    key={id}
                    draggable
                    onDragStart={() => setDragId(id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(id)}
                    className={cn("align-top", dragId === id && "opacity-50")}
                  >
                    <td className="cursor-grab py-1 text-muted-foreground" title="끌어서 순서 변경">
                      <GripVertical className="h-4 w-4" aria-hidden />
                    </td>
                    <td className="py-1 tabular-nums text-muted-foreground">{idx + 1}</td>
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
                );
              })}
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
