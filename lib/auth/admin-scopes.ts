import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import { roleFromUser, tenantIdFromUser } from "./tenant";
import {
  ADMIN_SCOPE_LABELS,
  isAdminScope,
  type AdminScope,
  type AdminScopeSet,
} from "./admin-scope-keys";

/**
 * 시스템 설정/관리 권한의 위임 (기획 확정)
 *
 * CEO는 'CEO 업무기능 + 시스템 설정·관리기능'을 모두 갖는다. 이 중 설정·관리
 * 기능만 임원 등에게 **스코프 단위로** 위임할 수 있다(tenant_admin_grants).
 *
 * 위임 대상이 **아닌** 것 (코드로 강제):
 *  - 세무(주민등록번호) 조회 지정자 관리 — CLAUDE.md §5. tax_access_grants는
 *    계속 CEO(org_admin)만 다룬다.
 *  - 위임 자체의 부여·회수 — 위임받은 사람이 다시 위임할 수 없다(권한 분리 §14-3).
 */

export {
  ADMIN_SCOPES,
  ADMIN_SCOPE_LABELS,
  ADMIN_SCOPE_DESCRIPTIONS,
  isAdminScope,
  type AdminScope,
  type AdminScopeSet,
} from "./admin-scope-keys";

const NONE: AdminScopeSet = {
  settings: false,
  staff: false,
  sending: false,
  audit: false,
};

/**
 * 현재 세션이 보유한 관리 스코프. CEO(org_admin)·플랫폼관리자는 전부 보유.
 * 화면 표시용이며, 실제 차단은 서버 액션의 requireAdminScope와 RLS가 담당한다.
 */
export async function getAdminScopes(): Promise<AdminScopeSet> {
  if (!hasSupabaseEnv()) return { ...NONE };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);

  if (!user || role === "platform_admin") {
    return role === "platform_admin"
      ? { settings: true, staff: true, sending: true, audit: true }
      : { ...NONE };
  }
  if (role === "org_admin") {
    return { settings: true, staff: true, sending: true, audit: true };
  }
  if (!tenantId) return { ...NONE };

  const { data } = await supabase
    .from("tenant_admin_grants")
    .select("scope")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  const scopes = { ...NONE };
  for (const row of data ?? []) {
    if (isAdminScope(row.scope)) scopes[row.scope] = true;
  }
  return scopes;
}

export type AdminScopeSession =
  | { ok: true; userId: string; tenantId: string; tenantSlug: string; isCeo: boolean }
  | { ok: false; error: string };

/**
 * 특정 관리 스코프가 필요한 서버 액션의 진입 가드.
 * CEO는 항상 통과, 그 외는 활성 위임이 있어야 통과한다.
 */
export async function requireAdminScope(
  scope: AdminScope
): Promise<AdminScopeSession> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const tenantSlug = user?.app_metadata?.tenant_slug;
  const role = roleFromUser(user);

  if (!user || !tenantId || typeof tenantSlug !== "string") {
    return { ok: false, error: "관리 권한이 필요합니다." };
  }

  if (role === "org_admin") {
    return { ok: true, userId: user.id, tenantId, tenantSlug, isCeo: true };
  }

  const { data: grant } = await supabase
    .from("tenant_admin_grants")
    .select("id")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .is("revoked_at", null)
    .maybeSingle();

  if (!grant) {
    return {
      ok: false,
      error: `${ADMIN_SCOPE_LABELS[scope]} 관리 권한이 없습니다.`,
    };
  }

  return { ok: true, userId: user.id, tenantId, tenantSlug, isCeo: false };
}

/** CEO(기업총괄관리자) 전용 — 위임 부여·회수, 세무 지정자 관리 등에 쓴다. */
export async function requireCeo(): Promise<AdminScopeSession> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const tenantSlug = user?.app_metadata?.tenant_slug;

  if (
    !user ||
    !tenantId ||
    typeof tenantSlug !== "string" ||
    roleFromUser(user) !== "org_admin"
  ) {
    return { ok: false, error: "대표(회사 총괄관리자) 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id, tenantId, tenantSlug, isCeo: true };
}
