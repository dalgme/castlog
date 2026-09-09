import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { recordActionDenial } from "@/lib/monitoring/action-denials";

/**
 * 프로젝트 문서 공용 권한 게이트 (체크리스트·견적·내부실견적·정산).
 * DB의 app.is_project_team과 같은 판정을 앱에서도 한 번 더 한다 — 서버 액션이
 * 조용히 0행을 고치고 성공을 돌려주는 일을 막고, 거부 사유를 문구로 준다.
 */

export type ProjectActor = {
  user: User;
  userId: string;
  tenantId: string;
  role: string;
  grade: string | null;
  name: string;
};

export type ActorGate =
  | { ok: true; actor: ProjectActor }
  | { ok: false; error: string };

/** 자사 임직원(전문가 제외) */
export async function requireTenantStaff(): Promise<ActorGate> {
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
 * 프로젝트 팀 — 배정된 누구나(PL·PM·부PM·담당) + 전사 열람 권한자(대표·이사) +
 * 개설자. 팀장 이하는 배정된 프로젝트만 (CLAUDE.md §3-1).
 * 프로젝트가 열람 범위(RLS) 밖이면 거부한다.
 */
export async function requireProjectTeam(
  projectId: string,
  denialKind = "exec:project-doc"
): Promise<ActorGate> {
  const staff = await requireTenantStaff();
  if (!staff.ok) return staff;
  const { actor } = staff;
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "프로젝트를 찾을 수 없습니다 (열람 범위 밖이거나 삭제됨)." };
  }
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
    "이 문서는 프로젝트 팀(PL·PM·부PM·담당)에 배정된 사람만 수정할 수 있습니다 (권한 규칙). 개요 탭의 팀 구성에서 배정을 받으세요.";
  await recordActionDenial({ kind: denialKind, message, user: actor.user });
  return { ok: false, error: message };
}
