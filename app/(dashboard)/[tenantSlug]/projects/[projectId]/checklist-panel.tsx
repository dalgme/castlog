"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, GripVertical, MessageSquare, Plus, Tag, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CHECKLIST_COLUMNS,
  CHECKLIST_KIND_LABELS,
  DUE_TONE_CLASS,
  DUE_TONE_LABELS,
  USE_BUTTON_KINDS,
  autoDueDate,
  dueTone,
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
  type Shade,
} from "@/lib/checklists/groups";
import { ChecklistLogsDialog } from "@/components/checklists/checklist-logs-dialog";
import { DateCell, EditableText } from "@/components/checklists/editable-cell";
import { DropEndRow, GroupHeaderRow } from "@/components/checklists/group-header-row";
import type React from "react";

import {
  acknowledgeDueChanges,
  addChecklistItem,
  createChecklistFromTemplate,
  deleteChecklistItem,
  deleteProjectChecklist,
  getProjectAllChecklistLogs,
  getProjectChecklistLogs,
  importCommonChecklist,
  importTypedItems,
  renameChecklistGroup,
  reorderChecklistItems,
  setPlannedDue,
  updateChecklistDday,
  updateChecklistItem,
  updateDueChangeReason,
  type ChecklistItemPatch,
} from "./checklist-actions";

export type DueChangeView = {
  id: string;
  changedOn: string;
  prevDue: string | null;
  newDue: string | null;
  reason: string;
  changedById: string | null;
  changedByName: string | null;
  openedById: string | null;
  openedByName: string | null;
};

export type ProjectChecklistItemView = {
  id: string;
  phase: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  offsetDays: number | null;
  quantity: string | null;
  assigneeUserId: string | null;
  plannedDue: string | null;
  completedOn: string | null;
  note: string | null;
  memo: string | null;
  check1: string | null;
  check2: string | null;
  decision: string | null;
  applicable: string | null;
  dueChanges: DueChangeView[];
};

export type ProjectChecklistView = {
  id: string;
  kind: ChecklistKind;
  name: string;
  templateId: string | null;
  dday: string | null;
  items: ProjectChecklistItemView[];
};

export type ChecklistHeader = {
  projectName: string;
  startsOn: string | null;
  endsOn: string | null;
  clientName: string | null;
  hostOrg: string | null;
  executorOrg: string | null;
  dday: string | null;
  viewerName: string;
};

export type TemplateOption = { id: string; kind: ChecklistKind; name: string; itemCount: number };

/**
 * 프로젝트 체크리스트 탭 (기획 지시 2026-09-05).
 * 상단은 프로젝트 정보 자동 채움(09), 표는 팀이 바로 고친다(02~04·08), 마감일
 * 잔여일 색상(05), 다음날부터의 마감 변경은 사유 팝업(06·07), 메모(07), 끌어서
 * 순서(10), 유형별 불러오기(12), 나머지 시트는 '사용하기'(13).
 */
export function ProjectChecklistPanel({
  tenantSlug,
  projectId,
  header,
  checklists,
  users,
  templates,
  typedSubcategories,
  canEdit,
  myUserId,
  today,
}: {
  tenantSlug: string;
  projectId: string;
  header: ChecklistHeader;
  checklists: ProjectChecklistView[];
  users: { id: string; name: string; grade: string }[];
  templates: TemplateOption[];
  /** 유형별 표준시트의 구분 → 세부 카테고리 목록 */
  typedSubcategories: { category: string; subcategories: string[] }[];
  canEdit: boolean;
  myUserId: string;
  today: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // 상급자 열람 표시 — 변경 사유가 상급자에게 '오픈'된 시점을 기록한다 (기획 07)
  useEffect(() => {
    void acknowledgeDueChanges(projectId).then((r) => {
      // 실제로 '오픈' 처리된 사유가 있을 때만 다시 그린다 (리뷰 M4)
      if (r.ok && r.opened > 0) router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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

  const hasCommon = checklists.some((c) => c.kind === "common");

  // 시트는 탭으로 전환한다 (기획 지시 2026-09-06). 새로 만든 시트가 생기면 그 탭으로.
  const idsKey = checklists.map((c) => c.id).join(",");
  const [selectedId, setSelectedId] = useState<string | null>(checklists[0]?.id ?? null);
  const prevIdsRef = useRef<string[]>(checklists.map((c) => c.id));
  useEffect(() => {
    const cur = checklists.map((c) => c.id);
    const added = cur.filter((id) => !prevIdsRef.current.includes(id));
    prevIdsRef.current = cur;
    if (added.length > 0) setSelectedId(added[added.length - 1]!);
    else if (!selectedId || !cur.includes(selectedId)) setSelectedId(cur[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  const selected = checklists.find((c) => c.id === selectedId) ?? checklists[0] ?? null;

  const dDayLeft = header.dday
    ? Math.round((Date.parse(header.dday) - Date.parse(today)) / 86_400_000)
    : null;

  return (
    <div className="space-y-5">
      {/* ── 상단 자동 채움 (기획 09) ─────────────────────────────────── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1.5 pt-4 text-xs sm:grid-cols-4">
          <Info label="프로젝트명" value={header.projectName} />
          <Info label="사업 시작일" value={header.startsOn ?? "-"} />
          <Info label="사업 종료일" value={header.endsOn ?? "-"} />
          <Info label="발주처" value={header.clientName ?? "-"} />
          <Info label="주관" value={header.hostOrg ?? "-"} />
          <Info label="수행기관" value={header.executorOrg ?? "-"} />
          <Info
            label="D-Day"
            value={
              header.dday
                ? `${header.dday}${dDayLeft !== null ? ` (D${dDayLeft > 0 ? "-" : "+"}${Math.abs(dDayLeft)})` : ""}`
                : "미정 (기본설정에서 D-Day 지정)"
            }
          />
          <Info label="담당자(로그인)" value={header.viewerName} />
          <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-4">
            TODAY {today} · 완료일 칸 색: <Legend />
          </p>
        </CardContent>
      </Card>

      {/* ── 시트 불러오기 / 사용하기 ─────────────────────────────────── */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {!hasCommon && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => run(() => importCommonChecklist(projectId), "공통 체크리스트를 불러왔습니다.")}
            >
              <Download className="mr-1 h-4 w-4" aria-hidden /> 공통 체크리스트 불러오기
            </Button>
          )}
          <TypedImportDialog
            groups={typedSubcategories}
            disabled={pending}
            onImport={(subs) =>
              run(async () => {
                const r = await importTypedItems(projectId, subs);
                return r;
              }, "유형별 항목을 추가했습니다.")
            }
          />
          {USE_BUTTON_KINDS.flatMap((kind) =>
            templates
              .filter((t) => t.kind === kind)
              .map((t) => {
                const used = checklists.some((c) => c.templateId === t.id);
                return (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || used}
                    title={used ? "이미 사용 중" : `${t.itemCount}개 항목`}
                    onClick={() => run(() => createChecklistFromTemplate(projectId, t.id), `${t.name}를 만들었습니다.`)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                    {t.name} 사용하기
                  </Button>
                );
              })
          )}
          <Button asChild variant="ghost" size="sm">
            <a href={`/${tenantSlug}/settings/checklists`}>표준시트 편집</a>
          </Button>
          <ChecklistLogsDialog
            title="이 프로젝트의 체크리스트 전체"
            load={() => getProjectAllChecklistLogs(projectId)}
          />
        </div>
      )}

      {checklists.length === 0 && (
        <Alert>
          <AlertDescription>
            아직 이 프로젝트에 체크리스트가 없습니다.{" "}
            {canEdit
              ? "‘공통 체크리스트 불러오기’로 시작하세요. 착수보고회·숙소·준비물품 시트는 ‘사용하기’로 따로 만듭니다."
              : "프로젝트 팀(PL·PM·부PM·담당)이 불러오면 여기에 표시됩니다."}
          </AlertDescription>
        </Alert>
      )}

      {checklists.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="체크리스트 시트">
          {checklists.map((c) => {
            const active = c.id === selected?.id;
            const done = c.items.filter((i) => i.completedOn).length;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "-mb-px rounded-t-md border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-b-white bg-white font-semibold text-brand"
                    : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {c.name}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  {c.items.length}
                  {CHECKLIST_COLUMNS[c.kind].some((col) => col.key === "plannedDue") && `/${done}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ChecklistCard
          key={selected.id}
          checklist={selected}
          users={users}
          canEdit={canEdit}
          myUserId={myUserId}
          today={today}
          pending={pending}
          run={run}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Legend() {
  const tones = ["overdue", "urgent", "soon", "ahead", "done"] as const;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {tones.map((t) => (
        <span key={t} className={cn("rounded border px-1.5 py-0.5 text-[10px]", DUE_TONE_CLASS[t])}>
          {DUE_TONE_LABELS[t]}
        </span>
      ))}
    </span>
  );
}

function TypedImportDialog({
  groups,
  disabled,
  onImport,
}: {
  groups: { category: string; subcategories: string[] }[];
  disabled: boolean;
  onImport: (subs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <Dialog open={open} onOpenChange={(n) => { setOpen(n); if (!n) setSelected([]); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled || groups.length === 0}>
          <Download className="mr-1 h-4 w-4" aria-hidden /> 유형별 항목 불러오기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>유형별 체크리스트 — 세부 카테고리 불러오기</DialogTitle>
          <DialogDescription>
            선택한 세부 카테고리의 항목이 프로젝트 체크리스트 끝에 추가됩니다. 추가된 뒤에는
            프로젝트에서 자유롭게 고칩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="mb-1 text-xs font-semibold">{g.category}</p>
              <div className="flex flex-wrap gap-2">
                {g.subcategories.map((s) => {
                  const on = selected.includes(s);
                  return (
                    <label
                      key={s}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                        on && "border-brand bg-brand/5"
                      )}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) =>
                          setSelected((prev) => (v ? [...prev, s] : prev.filter((x) => x !== s)))
                        }
                      />
                      {s}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>닫기</Button>
          <Button
            type="button"
            disabled={selected.length === 0}
            onClick={() => { onImport(selected); setOpen(false); setSelected([]); }}
          >
            {selected.length}개 카테고리 불러오기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistCard({
  checklist,
  users,
  canEdit,
  myUserId,
  today,
  pending,
  run,
}: {
  checklist: ProjectChecklistView;
  users: { id: string; name: string; grade: string }[];
  canEdit: boolean;
  myUserId: string;
  today: string;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
}) {
  const groupFields = GROUP_FIELDS[checklist.kind];
  // 분류 열은 묶음 머리행에 보이므로 항목 행에서는 뺀다
  const columns = CHECKLIST_COLUMNS[checklist.kind].filter(
    (c) => !(groupFields as string[]).includes(c.key)
  );
  const groupLabels = Object.fromEntries(
    (["phase", "category", "subcategory"] as GroupField[]).map((f) => [f, groupFieldLabel(checklist.kind, f)])
  ) as Record<GroupField, string>;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  // 낙관적 분류 이어받기 — 서버가 다시 그리기 전까지 옮긴 항목을 목적지 묶음으로 보이게 (리뷰 M2)
  const [overrides, setOverrides] = useState<Record<string, GroupValues>>({});
  const [openMemo, setOpenMemo] = useState<Record<string, boolean>>({});
  const [openClassify, setOpenClassify] = useState<Record<string, boolean>>({});
  const [dueDialog, setDueDialog] = useState<{ item: ProjectChecklistItemView; next: string | null } | null>(null);
  const serverIds = checklist.items.map((i) => i.id);
  const serverKey = serverIds.join(",");
  // 서버 목록이 바뀌면(추가·삭제·불러오기) 드래그 중 잡아 둔 순서를 버린다 (리뷰 M1)
  useEffect(() => {
    setOrder(null);
    setOverrides({});
  }, [serverKey]);
  const ids = order ?? serverIds;
  const byId = new Map(
    checklist.items.map((i) => [i.id, overrides[i.id] ? { ...i, ...overrides[i.id] } : i])
  );
  const groups = buildGroups(ids, byId, groupFields);
  const hasSchedule = columns.some((c) => c.key === "plannedDue");
  const span = columns.length + 3;

  function commitOrder(next: string[], adopt: { itemIds: string[]; values: GroupValues } | null) {
    setDrag(null);
    // 자리도 분류도 그대로면 서버에 보내지 않는다 (리뷰 M4)
    if (adopt === null && next.join(",") === ids.join(",")) return;
    setOrder(next);
    if (adopt) {
      setOverrides((o) => ({ ...o, ...Object.fromEntries(adopt.itemIds.map((id) => [id, adopt.values])) }));
    }
    run(async () => {
      const r = await reorderChecklistItems(checklist.id, next, adopt);
      if (!r.ok) {
        setOrder(null);
        setOverrides({});
      }
      return r;
    });
  }

  /** 항목 위에 놓기 — 항목은 그 앞으로(분류 이어받음), 묶음은 그 항목의 묶음 앞으로 */
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

  /** 묶음 머리행에 놓기 — 항목은 그 묶음 맨 앞으로 들어가고, 묶음은 그 묶음 앞으로 */
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

  function patch(item: ProjectChecklistItemView, key: string, value: string | null) {
    let p: ChecklistItemPatch;
    if (key === "offsetDays") {
      const n = value === null ? null : Number(value);
      p = { offsetDays: value === null || Number.isNaN(n) ? null : n };
    } else if (key === "title") p = { title: value ?? "" };
    else p = { [key]: value } as ChecklistItemPatch;
    run(() => updateChecklistItem(item.id, p));
  }

  function changePlannedDue(item: ProjectChecklistItemView, next: string | null) {
    run(async () => {
      const r = await setPlannedDue(item.id, next, null);
      if (!r.ok && r.needsReason) {
        setDueDialog({ item, next });
        return { ok: true };
      }
      return r;
    });
  }

  const done = checklist.items.filter((i) => i.completedOn).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {checklist.name}
          <span className="text-[11px] font-normal text-muted-foreground">
            {CHECKLIST_KIND_LABELS[checklist.kind]} · {checklist.items.length}개
            {hasSchedule && ` · 완료 ${done}`}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {hasSchedule && (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              D-Day
              <DateCell
                value={checklist.dday}
                disabled={!canEdit}
                ariaLabel="D-Day"
                className="w-36 rounded border border-input px-1 py-0.5 text-xs"
                onCommit={(v) => run(() => updateChecklistDday(checklist.id, v))}
              />
            </label>
          )}
          <ChecklistLogsDialog title={checklist.name} load={() => getProjectChecklistLogs(checklist.id)} />
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`'${checklist.name}'를 삭제할까요? 항목이 지워집니다. 변경 로그는 '이 프로젝트의 체크리스트 전체' 로그에 남습니다.`)) {
                  run(() => deleteProjectChecklist(checklist.id), "삭제했습니다.");
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
            {groupFields.map((f) => groupLabels[f]).join(" › ")} 묶음별로 음영이 다릅니다. 묶음 머리행에서 이름을
            고치면 묶음 전체에 적용되고, 머리행 손잡이를 끌면 묶음이 통째로 움직입니다. 항목을 다른 묶음에
            놓으면 그 분류로 들어갑니다. 항목 하나만 다른 분류로 두려면 행 끝의 분류(태그) 단추를 누르세요.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="w-6" />
                <th className="w-8 py-1 font-medium">No</th>
                {columns.map((c) => (
                  <th key={c.key} className={cn("py-1 pr-2 font-medium", c.width)}>{c.label}</th>
                ))}
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(() => {
                let idx = 0;
                return groups.map((g) => (
                  <GroupBlock
                    key={g.anchorId}
                    group={g}
                    fields={groupFields}
                    span={span}
                    canEdit={canEdit}
                    pending={pending}
                    labels={groupLabels}
                    dragging={drag?.kind === "group" && drag.key === g.key}
                    onDragStart={() => setDrag({ kind: "group", key: g.key, ids: g.ids })}
                    onDragEnd={() => setDrag(null)}
                    onDrop={() => dropOnGroup(g)}
                    onRename={(field, value) =>
                      run(() => renameChecklistGroup(checklist.id, g.ids, field, value), "분류 이름을 바꿨습니다.")
                    }
                    onAdd={() => run(() => addChecklistItem(checklist.id, g.ids[g.ids.length - 1] ?? null, "새 항목"))}
                  >
                    {g.ids.map((id) => {
                      const item = byId.get(id);
                      if (!item) return null;
                      const rowIdx = idx;
                      idx += 1;
                      const tone = dueTone(item.plannedDue, item.completedOn, today);
                      const auto = autoDueDate(checklist.dday, item.offsetDays);
                      const memoOpen = openMemo[id] ?? false;
                      const classifyOpen = openClassify[id] ?? false;
                      return (
                        <ItemRows
                          key={id}
                          idx={rowIdx}
                          item={item}
                          columns={columns}
                          groupFields={groupFields}
                          groupLabels={groupLabels}
                          tone={tone}
                          auto={auto}
                          shade={g.shade}
                          users={users}
                          canEdit={canEdit}
                          myUserId={myUserId}
                          pending={pending}
                          dragging={
                            (drag?.kind === "item" && drag.id === id) ||
                            (drag?.kind === "group" && drag.ids.includes(id))
                          }
                          memoOpen={memoOpen}
                          classifyOpen={classifyOpen}
                          onToggleMemo={() => setOpenMemo((m) => ({ ...m, [id]: !memoOpen }))}
                          onToggleClassify={() => setOpenClassify((m) => ({ ...m, [id]: !classifyOpen }))}
                          onDragStart={() => setDrag({ kind: "item", id })}
                          onDragEnd={() => setDrag(null)}
                          onDrop={() => dropOnItem(id)}
                          onPatch={(k, v) => patch(item, k, v)}
                          onPlannedDue={(v) => changePlannedDue(item, v)}
                          onAddAfter={() => run(() => addChecklistItem(checklist.id, item.id, "새 항목"))}
                          onDelete={() => {
                            if (window.confirm(`'${item.title}' 항목을 삭제할까요?`)) run(() => deleteChecklistItem(item.id));
                          }}
                          onReason={(changeId, reason) => run(() => updateDueChangeReason(changeId, reason), "변경 사유를 고쳤습니다.")}
                        />
                      );
                    })}
                  </GroupBlock>
                ));
              })()}
              {canEdit && ids.length > 0 && <DropEndRow colSpan={span} active={drag !== null} onDrop={dropAtEnd} />}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={pending}
            onClick={() => run(() => addChecklistItem(checklist.id, null, "새 항목"))}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> 항목 추가
          </Button>
        )}
      </CardContent>
      {dueDialog && (
        <DueChangeDialog
          item={dueDialog.item}
          next={dueDialog.next}
          today={today}
          onClose={() => setDueDialog(null)}
          onSubmit={(changedOn, reason) => {
            const { item, next } = dueDialog;
            setDueDialog(null);
            run(() => setPlannedDue(item.id, next, { changedOn, reason }), "마감일 계획을 변경하고 사유를 기록했습니다.");
          }}
        />
      )}
    </Card>
  );
}

type Drag = { kind: "item"; id: string } | { kind: "group"; key: string; ids: string[] };

/** 묶음 머리행 + 그 묶음의 항목 행들. 묶음 열이 없는 종류(마감일)는 머리행 없이 항목만 */
function GroupBlock({
  group, fields, labels, span, canEdit, pending, dragging, onDragStart, onDragEnd, onDrop, onRename, onAdd, children,
}: {
  group: ItemGroup;
  fields: GroupField[];
  span: number;
  canEdit: boolean;
  pending: boolean;
  dragging: boolean;
  labels: Record<GroupField, string>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRename: (field: GroupField, value: string | null) => void;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {fields.length > 0 && (
        <GroupHeaderRow
          fields={fields}
          labels={labels}
          values={group.values}
          count={group.ids.length}
          colSpan={span}
          canEdit={canEdit}
          shade={group.shade}
          dragging={dragging}
          pending={pending}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          onRename={onRename}
          onAdd={onAdd}
        />
      )}
      {children}
    </>
  );
}

function ItemRows({
  idx, item, columns, groupFields, groupLabels, tone, auto, shade, users, canEdit, myUserId, pending, dragging,
  memoOpen, classifyOpen, onToggleMemo, onToggleClassify, onDragStart, onDragEnd, onDrop, onPatch, onPlannedDue,
  onAddAfter, onDelete, onReason,
}: {
  idx: number;
  item: ProjectChecklistItemView;
  columns: { key: string; label: string; width?: string }[];
  groupFields: GroupField[];
  groupLabels: Record<GroupField, string>;
  tone: ReturnType<typeof dueTone>;
  auto: string | null;
  shade: Shade;
  users: { id: string; name: string }[];
  canEdit: boolean;
  myUserId: string;
  pending: boolean;
  dragging: boolean;
  memoOpen: boolean;
  classifyOpen: boolean;
  onToggleMemo: () => void;
  onToggleClassify: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onPatch: (key: string, value: string | null) => void;
  onPlannedDue: (value: string | null) => void;
  onAddAfter: () => void;
  onDelete: () => void;
  onReason: (changeId: string, reason: string) => void;
}) {
  const span = columns.length + 3;
  return (
    <>
      <tr
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
        className={cn("align-top", shade.row, dragging && "opacity-50")}
      >
        {/* 드래그 손잡이만 draggable — 행 전체면 칸 안 글자 선택이 안 된다 (리뷰 H4) */}
        <td
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className={cn("py-1 text-muted-foreground", canEdit && "cursor-grab")}
          title={canEdit ? "끌어서 순서 변경" : undefined}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </td>
        <td className="py-1 tabular-nums text-muted-foreground">{idx + 1}</td>
        {columns.map((c) => {
          if (c.key === "assignee") {
            return (
              <td key={c.key} className="py-0.5 pr-2">
                <select
                  value={item.assigneeUserId ?? ""}
                  disabled={!canEdit}
                  aria-label={`${item.title} 담당`}
                  onChange={(e) => onPatch("assigneeUserId", e.target.value || null)}
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-input focus:border-brand"
                >
                  <option value="">-</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </td>
            );
          }
          if (c.key === "autoDue") {
            return <td key={c.key} className="py-1 pr-2 tabular-nums text-muted-foreground">{auto ?? "-"}</td>;
          }
          if (c.key === "plannedDue") {
            return (
              <td key={c.key} className="py-0.5 pr-2">
                <DateCell
                  value={item.plannedDue}
                  disabled={!canEdit}
                  ariaLabel={`${item.title} 마감일 계획`}
                  onCommit={onPlannedDue}
                />
              </td>
            );
          }
          if (c.key === "completedOn") {
            return (
              <td key={c.key} className={cn("py-0.5 pr-2", DUE_TONE_CLASS[tone])} title={DUE_TONE_LABELS[tone] || undefined}>
                <DateCell
                  value={item.completedOn}
                  disabled={!canEdit}
                  ariaLabel={`${item.title} 완료일`}
                  onCommit={(v) => onPatch("completedOn", v)}
                  className={cn(
                    (tone === "overdue" || tone === "urgent" || tone === "soon") && "text-white [color-scheme:dark]"
                  )}
                />
              </td>
            );
          }
          if (c.key === "note") {
            return (
              <td key={c.key} className="py-0.5 pr-2">
                <EditableText
                  value={item.note}
                  multiline
                  disabled={!canEdit}
                  onSave={(v) => onPatch("note", v)}
                />
                {item.dueChanges.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l-2 border-amber-300 pl-1.5 text-[11px]">
                    {item.dueChanges.map((ch) => {
                      const editable =
                        canEdit && (ch.openedById ? ch.openedById === myUserId : ch.changedById === myUserId);
                      return (
                        <li key={ch.id} className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            [마감 변경 {ch.changedOn}] {ch.prevDue ?? "-"} → {ch.newDue ?? "-"}
                          </span>{" "}
                          · {ch.changedByName ?? "?"}
                          {ch.openedByName && <span className="text-amber-700"> · {ch.openedByName} 확인</span>}
                          <EditableText
                            value={ch.reason}
                            multiline
                            disabled={!editable}
                            onSave={(v) => { if (v) onReason(ch.id, v); }}
                            className="text-foreground"
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </td>
            );
          }
          const raw =
            c.key === "offsetDays"
              ? item.offsetDays === null ? null : String(item.offsetDays)
              : (item[c.key as keyof ProjectChecklistItemView] as string | null);
          return (
            <td key={c.key} className="py-0.5 pr-2">
              <EditableText
                value={raw}
                multiline={c.key === "title" || c.key === "decision" || c.key === "check1" || c.key === "check2"}
                type={c.key === "offsetDays" ? "number" : "text"}
                disabled={!canEdit}
                placeholder={c.key === "offsetDays" ? "D±" : c.key === "check1" || c.key === "check2" ? "O / X / 메모" : ""}
                onSave={(v) => onPatch(c.key, v)}
              />
            </td>
          );
        })}
        <td className="py-0.5 text-right">
          <button
            type="button"
            title={item.memo ? "메모 보기" : "메모"}
            className={cn("rounded p-1 hover:text-brand", item.memo ? "text-brand" : "text-muted-foreground")}
            onClick={onToggleMemo}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          </button>
          {canEdit && groupFields.length > 0 && (
            <button
              type="button"
              title="이 항목만 분류 바꾸기"
              className={cn("rounded p-1 hover:text-brand", classifyOpen ? "text-brand" : "text-muted-foreground")}
              onClick={onToggleClassify}
            >
              <Tag className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {canEdit && (
            <>
              <button type="button" title="아래에 항목 추가" className="rounded p-1 text-muted-foreground hover:text-brand" disabled={pending} onClick={onAddAfter}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" title="항목 삭제" className="rounded p-1 text-muted-foreground hover:text-red-600" disabled={pending} onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </td>
      </tr>
      {classifyOpen && canEdit && (
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
                    <EditableText value={item[f]} placeholder="(미분류)" onSave={(v) => onPatch(f, v)} />
                  </span>
                </label>
              ))}
            </div>
          </td>
        </tr>
      )}
      {memoOpen && (
        <tr className="bg-secondary/30">
          <td colSpan={span} className="px-8 py-1.5">
            <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">메모 — {item.title}</p>
            <EditableText
              value={item.memo}
              multiline
              disabled={!canEdit}
              placeholder="이 실행목록에 대한 메모"
              onSave={(v) => onPatch("memo", v)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DueChangeDialog({
  item,
  next,
  today,
  onClose,
  onSubmit,
}: {
  item: ProjectChecklistItemView;
  next: string | null;
  today: string;
  onClose: () => void;
  onSubmit: (changedOn: string, reason: string) => void;
}) {
  const [changedOn, setChangedOn] = useState(today);
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(n) => { if (!n) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>마감일 계획 변경 — 사유 기록</DialogTitle>
          <DialogDescription>
            정한 다음날부터의 마감일 변경은 변경 일자와 사유를 남겨야 합니다 (규칙).
            사유는 참고사항 아래 변경 이력으로 표시되고, 상급자가 확인한 뒤에는 그 상급자만 고칠 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {item.title}: {item.plannedDue ?? "-"} → {next ?? "(비움)"}
          </p>
          <label className="block text-xs">
            변경 일자
            <Input type="date" value={changedOn} onChange={(e) => setChangedOn(e.target.value)} />
          </label>
          <label className="block text-xs">
            변경 사유
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 발주처 일정 조정으로 1주 연기" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="button" disabled={!reason.trim() || !changedOn} onClick={() => onSubmit(changedOn, reason)}>
            변경 기록하고 저장
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
