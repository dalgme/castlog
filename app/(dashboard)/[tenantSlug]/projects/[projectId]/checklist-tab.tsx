import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { ensureTenantTemplates } from "@/lib/checklists/server";
import { isChecklistKind, kstToday, type ChecklistKind } from "@/lib/checklists/kinds";
import { EmptyState } from "@/components/layout/empty-state";

import {
  ProjectChecklistPanel,
  type ChecklistHeader,
  type ProjectChecklistView,
  type TemplateOption,
} from "./checklist-panel";

/**
 * 체크리스트 탭 로더 (서버) — 표준시트·프로젝트 시트·변경 사유·담당자 목록을
 * 모아 패널에 넘긴다. 열람은 RLS(프로젝트 열람 범위), 편집 자격은 page에서
 * 판정해 canEdit로 받는다.
 */
export async function ChecklistTab({
  tenantSlug,
  tenantId,
  project,
  viewerUserId,
  viewerName,
  canEdit,
}: {
  tenantSlug: string;
  tenantId: string;
  project: {
    id: string;
    name: string;
    starts_on: string | null;
    ends_on: string | null;
    client_name: string | null;
    host_org: string | null;
    executor_org: string | null;
    dday_date: string | null;
  };
  viewerUserId: string;
  viewerName: string;
  canEdit: boolean;
}) {
  if (!hasSupabaseEnv()) return null;
  await ensureTenantTemplates(tenantId);
  const supabase = createClient();

  const [{ data: templateRows, error: templateError }, { data: checklistRows }, { data: userRows }] =
    await Promise.all([
      supabase
        .from("checklist_templates")
        .select("id, kind, name")
        .eq("is_active", true)
        .order("kind", { ascending: true })
        .order("sort_order", { ascending: true }),
      supabase
        .from("project_checklists")
        .select("id, kind, name, template_id, dday_date, created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("users")
        .select("id, name, grade")
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);

  if (templateError && templateError.code === "42P01") {
    return (
      <EmptyState
        title="체크리스트 기능이 아직 준비되지 않았습니다"
        description="마이그레이션(20260905000004) 적용 후 사용할 수 있습니다 — 캐스트로그에 알려 주세요."
      />
    );
  }

  const templateIds = (templateRows ?? []).map((t) => t.id);
  const { data: templateItems } = templateIds.length
    ? await supabase
        .from("checklist_template_items")
        .select("template_id, category, subcategory")
        .in("template_id", templateIds)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const countByTemplate = new Map<string, number>();
  for (const it of templateItems ?? []) {
    countByTemplate.set(it.template_id, (countByTemplate.get(it.template_id) ?? 0) + 1);
  }
  const templates: TemplateOption[] = (templateRows ?? [])
    .filter((t): t is typeof t & { kind: ChecklistKind } => isChecklistKind(t.kind))
    .map((t) => ({ id: t.id, kind: t.kind, name: t.name, itemCount: countByTemplate.get(t.id) ?? 0 }));

  // 유형별 시트의 구분 → 세부 카테고리 (불러오기 선택지, 기획 12)
  const typedIds = new Set(templates.filter((t) => t.kind === "typed").map((t) => t.id));
  const groups = new Map<string, Set<string>>();
  for (const it of templateItems ?? []) {
    if (!typedIds.has(it.template_id) || !it.subcategory || it.subcategory === "추진일정") continue;
    const cat = it.category ?? "기타";
    if (!groups.has(cat)) groups.set(cat, new Set());
    groups.get(cat)!.add(it.subcategory);
  }
  const typedSubcategories = Array.from(groups.entries()).map(([category, subs]) => ({
    category,
    subcategories: Array.from(subs),
  }));

  const checklistIds = (checklistRows ?? []).map((c) => c.id);
  const [{ data: itemRows }, { data: changeRows }] = await Promise.all([
    checklistIds.length
      ? supabase
          .from("project_checklist_items")
          .select(
            "id, checklist_id, phase, category, subcategory, title, offset_days, quantity, assignee_user_id, planned_due_on, completed_on, note, memo, check1, check2, decision, applicable"
          )
          .in("checklist_id", checklistIds)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("project_checklist_due_changes")
      .select("id, item_id, changed_on, prev_due_on, new_due_on, reason, changed_by, opened_by")
      .eq("project_id", project.id)
      .order("created_at", { ascending: true }),
  ]);

  const nameById = new Map((userRows ?? []).map((u) => [u.id, u.name]));
  const changesByItem = new Map<string, ProjectChecklistView["items"][number]["dueChanges"]>();
  for (const ch of changeRows ?? []) {
    const list = changesByItem.get(ch.item_id) ?? [];
    list.push({
      id: ch.id,
      changedOn: ch.changed_on,
      prevDue: ch.prev_due_on,
      newDue: ch.new_due_on,
      reason: ch.reason,
      changedById: ch.changed_by,
      changedByName: ch.changed_by ? (nameById.get(ch.changed_by) ?? null) : null,
      openedById: ch.opened_by,
      openedByName: ch.opened_by ? (nameById.get(ch.opened_by) ?? null) : null,
    });
    changesByItem.set(ch.item_id, list);
  }

  const checklists: ProjectChecklistView[] = (checklistRows ?? [])
    .filter((c): c is typeof c & { kind: ChecklistKind } => isChecklistKind(c.kind))
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      templateId: c.template_id,
      dday: c.dday_date,
      items: (itemRows ?? [])
        .filter((it) => it.checklist_id === c.id)
        .map((it) => ({
          id: it.id,
          phase: it.phase,
          category: it.category,
          subcategory: it.subcategory,
          title: it.title,
          offsetDays: it.offset_days,
          quantity: it.quantity,
          assigneeUserId: it.assignee_user_id,
          plannedDue: it.planned_due_on,
          completedOn: it.completed_on,
          note: it.note,
          memo: it.memo,
          check1: it.check1,
          check2: it.check2,
          decision: it.decision,
          applicable: it.applicable,
          dueChanges: changesByItem.get(it.id) ?? [],
        })),
    }));

  const header: ChecklistHeader = {
    projectName: project.name,
    startsOn: project.starts_on,
    endsOn: project.ends_on,
    clientName: project.client_name,
    hostOrg: project.host_org,
    executorOrg: project.executor_org,
    dday: project.dday_date,
    viewerName,
  };

  return (
    <ProjectChecklistPanel
      tenantSlug={tenantSlug}
      projectId={project.id}
      header={header}
      checklists={checklists}
      users={(userRows ?? []).map((u) => ({ id: u.id, name: u.name, grade: u.grade }))}
      templates={templates}
      typedSubcategories={typedSubcategories}
      canEdit={canEdit}
      myUserId={viewerUserId}
      today={kstToday()}
    />
  );
}
