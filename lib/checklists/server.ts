import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  gradeFromUser,
  practiceFromUser,
  roleFromUser,
  tenantIdFromUser,
} from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { recordActionDenial } from "@/lib/monitoring/action-denials";

import { DEFAULT_CHECKLIST_TEMPLATES } from "./default-templates";

/**
 * 체크리스트 서버 공용 — 표준시트 시드, 권한 게이트, 변경 로그.
 * (기획 지시 2026-09-05)
 */

/**
 * 표준시트가 하나도 없는 테넌트에 기본 양식(렛츠 ver.20260703)을 1회 시드한다.
 * 요청 단위 cache — 같은 렌더에서 두 번 세지 않는다. 동시 첫 진입은 공통·유형별
 * 유니크 인덱스(20260905000005)가 막는다 — 충돌 나면 그 시트는 건너뛴다.
 */
export const ensureTenantTemplates = cache(async (tenantId: string): Promise<void> => {
  if (!hasSupabaseEnv()) return;
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("checklist_templates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error || (count ?? 0) > 0) return;

  for (const t of DEFAULT_CHECKLIST_TEMPLATES) {
    const { data: created, error: insertError } = await admin
      .from("checklist_templates")
      .insert({
        tenant_id: tenantId,
        kind: t.kind,
        name: t.name,
        sort_order: t.sortOrder,
      })
      .select("id")
      .single();
    if (insertError?.code === "23505") continue; // 다른 요청이 먼저 시드했다
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
});

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

/** 표준시트 편집 — 임직원 누구나. 연습모드에서는 회사 표준을 건드리지 않는다 (리뷰 M7) */
export async function requireTemplateEditor(): Promise<
  { ok: true; actor: ChecklistActor } | { ok: false; error: string }
> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  if (practiceFromUser(staff.actor.user)) {
    return {
      ok: false,
      error: "연습모드에서는 회사 표준시트를 수정하지 않습니다 (규칙). 연습을 끄고 다시 시도해 주세요.",
    };
  }
  return staff;
}

/**
 * 프로젝트 팀 — 배정된 누구나(PL·PM·부PM·담당) + 전사 열람 권한자(대표·이사) +
 * 개설자. 팀장 이하는 배정된 프로젝트만 (CLAUDE.md §3-1). DB의 app.is_project_team과
 * 같은 판정 (기획 02·03·04·08). 프로젝트가 열람 범위(RLS) 밖이면 거부한다.
 */
export async function requireProjectTeam(projectId: string): Promise<
  { ok: true; actor: ChecklistActor } | { ok: false; error: string }
> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  const { actor } = staff;
  const supabase = createClient();
  // RLS로 보이는 프로젝트인가 — 테넌트·연습모드·열람 범위를 한 번에 판정
  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  if (actor.role === "platform_admin" || actor.role === "org_admin") return staff;
  if (isUserGrade(actor.grade) && canViewAllProjects(actor.grade)) return staff;
  if (project.created_by === actor.userId) return staff;
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
