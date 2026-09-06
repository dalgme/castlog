import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { recordActionDenial } from "@/lib/monitoring/action-denials";

import { DEFAULT_CHECKLIST_TEMPLATES } from "./default-templates";

/**
 * 체크리스트 서버 공용 — 표준시트 시드, 권한 게이트, 변경 로그.
 * (기획 지시 2026-09-05)
 */

/** 표준시트가 하나도 없는 테넌트에 기본 양식(렛츠 ver.20260703)을 1회 시드한다 */
export async function ensureTenantTemplates(tenantId: string): Promise<void> {
  if (!hasSupabaseEnv()) return;
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("checklist_templates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error || (count ?? 0) > 0) return;

  for (const t of DEFAULT_CHECKLIST_TEMPLATES) {
    const { data: created } = await admin
      .from("checklist_templates")
      .insert({
        tenant_id: tenantId,
        kind: t.kind,
        name: t.name,
        sort_order: t.sortOrder,
      })
      .select("id")
      .single();
    if (!created) continue;
    const rows = t.items.map((it, i) => ({
      tenant_id: tenantId,
      template_id: created.id,
      sort_order: (i + 1) * 10,
      phase: it.phase,
      category: it.category,
      subcategory: it.subcategory,
      title: it.title,
      offset_days: it.offsetDays,
      quantity: it.quantity,
      note: it.note,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await admin.from("checklist_template_items").insert(rows.slice(i, i + 200));
    }
  }
}

export type ChecklistActor = {
  user: User;
  userId: string;
  tenantId: string;
  role: string;
  grade: string | null;
  name: string;
};

/** 자사 임직원(전문가 제외) — 표준시트 편집 자격 (기획 01·11·13·14: 누구나) */
export async function requireTenantStaff(): Promise<
  { ok: true; actor: ChecklistActor } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  const { data: me } = await supabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  return {
    ok: true,
    actor: {
      user,
      userId: user.id,
      tenantId,
      role,
      grade: gradeFromUser(user),
      name: me?.name ?? "",
    },
  };
}

/**
 * 프로젝트 팀 — 배정된 누구나(PL·PM·부PM·담당) + 전사 열람 권한자(대표·이사·팀장).
 * DB의 app.is_project_team과 같은 판정 (기획 02·03·04·08).
 */
export async function requireProjectTeam(projectId: string): Promise<
  { ok: true; actor: ChecklistActor } | { ok: false; error: string }
> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  const { actor } = staff;
  if (actor.role === "platform_admin" || actor.role === "org_admin" || actor.role === "manager") {
    return staff;
  }
  if (isUserGrade(actor.grade) && canViewAllProjects(actor.grade)) return staff;
  const supabase = createClient();
  const { data: mine } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (mine) return staff;
  const message =
    "프로젝트 체크리스트는 이 프로젝트 팀(PL·PM·부PM·담당)에 배정된 사람만 수정할 수 있습니다 (권한 규칙). 개요 탭의 팀 구성에서 배정을 받으세요.";
  await recordActionDenial({ kind: "exec:checklist", message, user: actor.user });
  return { ok: false, error: message };
}

export type ChecklistLogEntry = {
  scope: "template" | "project";
  action: string;
  templateId?: string | null;
  checklistId?: string | null;
  projectId?: string | null;
  itemId?: string | null;
  itemTitle?: string | null;
  field?: string | null;
  before?: string | null;
  after?: string | null;
};

/** 변경 로그 — 언제·누가·어떤 항목을 (기획 11·13·15) */
export async function logChecklist(
  actor: ChecklistActor,
  entry: ChecklistLogEntry
): Promise<void> {
  const supabase = createClient();
  await supabase.from("checklist_logs").insert({
    tenant_id: actor.tenantId,
    scope: entry.scope,
    action: entry.action,
    template_id: entry.templateId ?? null,
    checklist_id: entry.checklistId ?? null,
    project_id: entry.projectId ?? null,
    item_id: entry.itemId ?? null,
    item_title: entry.itemTitle ?? null,
    field: entry.field ?? null,
    before_value: entry.before ?? null,
    after_value: entry.after ?? null,
    actor_user_id: actor.userId,
    actor_name: actor.name,
  });
}
