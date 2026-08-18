"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";

/**
 * 프로젝트 미연결 섭외 건을 프로젝트에 붙인다 (CLAUDE.md §1-2-8 후행 활성 대응).
 *
 * 왜 필요한가: experts만 쓰던 테넌트는 프로젝트 없이 섭외를 만들 수 있어서
 * project_id가 비어 있다. 나중에 프로젝트를 쓰기 시작해도 그 이력이 프로젝트
 * 대시보드·예산 집계·평가·지급 묶음에서 영구히 빠졌다. 모듈을 나중에 켜도
 * 기존 데이터가 이어져야 한다는 원칙에 어긋나므로 연결 경로를 제공한다.
 *
 * 원칙:
 *  - **이미 프로젝트에 붙은 건은 옮기지 않는다.** 프로젝트 간 이동은 예산·정산
 *    집계를 소급해서 흔든다. 붙이는 것(null → 프로젝트)만 허용한다.
 *  - 섭외계획 품의 게이트는 적용하지 않는다. 이 작업은 새 섭외를 만드는 게
 *    아니라 이미 성사된 과거 이력을 제자리에 놓는 정리 작업이다.
 *  - 전건 감사로그.
 */

export type AttachResult =
  | { ok: true; attached: number }
  | { ok: false; error: string };

export type UnlinkedEngagement = {
  id: string;
  expertName: string;
  roleDescription: string;
  statusLabel: string;
  startsOn: string | null;
  feeAmount: number | null;
  createdAt: string;
};

const MANAGER_ROLES = ["org_admin", "manager"];

async function requireManager(): Promise<
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "섭외 건 연결 권한이 없습니다(관리자 이상)." };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

/**
 * 프로젝트에 연결되지 않은 섭외 건 목록.
 * 취소·만료 건은 붙일 이유가 없으므로 제외한다.
 */
export async function listUnlinkedEngagements(): Promise<UnlinkedEngagement[]> {
  const auth = await requireManager();
  if (!auth.ok) return [];

  const supabase = createClient();
  const { data } = await supabase
    .from("expert_engagements")
    .select(
      "id, role_description, status, starts_on, fee_amount, created_at, experts (name)"
    )
    .is("project_id", null)
    .in("status", ["requested", "accepted"])
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((e) => ({
    id: e.id,
    expertName: e.experts?.name ?? "-",
    roleDescription: e.role_description,
    statusLabel: ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status,
    startsOn: e.starts_on,
    feeAmount: e.fee_amount,
    createdAt: e.created_at,
  }));
}

/** 선택한 미연결 섭외 건들을 이 프로젝트에 붙인다. */
export async function attachEngagementsToProject(
  projectId: string,
  engagementIds: string[]
): Promise<AttachResult> {
  const auth = await requireManager();
  if (!auth.ok) return auth;

  const ids = Array.from(new Set(engagementIds.filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: "연결할 섭외 건을 선택하세요." };
  if (ids.length > 200) {
    return { ok: false, error: "한 번에 200건까지 연결할 수 있습니다." };
  }

  const supabase = createClient();

  // 대상 프로젝트가 이 세션에 보이는지 (RLS가 이미 걸러주지만 명시 확인)
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (project.status === "completed" || project.status === "cancelled") {
    return {
      ok: false,
      error: "종료·취소된 프로젝트에는 섭외 건을 연결할 수 없습니다.",
    };
  }

  // project_id가 비어 있는 건만 갱신한다 — 이미 붙은 건을 다른 프로젝트로
  // 옮기면 예산·정산 집계가 소급해서 흔들린다.
  const { data: updated, error } = await supabase
    .from("expert_engagements")
    .update({ project_id: projectId })
    .in("id", ids)
    .is("project_id", null)
    .select("id");

  if (error) return { ok: false, error: "섭외 건 연결에 실패했습니다." };

  const attached = updated?.length ?? 0;
  if (attached === 0) {
    return {
      ok: false,
      error: "연결된 건이 없습니다. 이미 다른 프로젝트에 연결되어 있을 수 있습니다.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "engagement.attach_project",
    resource_type: "project",
    resource_id: projectId,
    after_data: {
      project_name: project.name,
      engagement_ids: updated?.map((u) => u.id) ?? [],
      count: attached,
    },
  });

  revalidatePath(`/[tenantSlug]/projects/${projectId}`, "page");
  revalidatePath("/[tenantSlug]/experts/engagements", "page");
  return { ok: true, attached };
}
