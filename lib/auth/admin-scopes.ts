import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { recordActionDenial } from "@/lib/monitoring/action-denials";

import { gradeFromUser, roleFromUser, tenantIdFromUser } from "./tenant";
import { gradeAtLeast } from "./grades";
import {
  ADMIN_SCOPES as ALL_SCOPES,
  ADMIN_SCOPE_LABELS,
  expandScopes,
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
  ADMIN_SCOPE_GROUPS,
  ADMIN_SCOPE_RISK,
  SCOPE_IMPLIES,
  expandScopes,
  isAdminScope,
  type AdminScope,
  type AdminScopeSet,
} from "./admin-scope-keys";

function emptySet(): AdminScopeSet {
  const out = {} as AdminScopeSet;
  for (const scope of ALL_SCOPES) out[scope] = false;
  return out;
}

function fullSet(): AdminScopeSet {
  const out = {} as AdminScopeSet;
  for (const scope of ALL_SCOPES) out[scope] = true;
  return out;
}

const NONE: AdminScopeSet = emptySet();
const ALL: AdminScopeSet = fullSet();

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
    return role === "platform_admin" ? { ...ALL } : { ...NONE };
  }
  if (role === "org_admin") return { ...ALL };
  if (!tenantId) return { ...NONE };

  const { data } = await supabase
    .from("tenant_admin_grants")
    .select("scope")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  const granted: AdminScope[] = [];
  for (const row of data ?? []) {
    if (isAdminScope(row.scope)) granted.push(row.scope);
  }
  const scopes = { ...NONE };
  // 넓은 스코프는 그 안에서 갈라져 나온 스코프를 포함한다 — 세분화 이전에
  // 부여한 위임이 끊기면 안 된다
  for (const scope of expandScopes(granted)) scopes[scope] = true;
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

  // 요청한 스코프를 직접 가졌거나, 그것을 포함하는 넓은 스코프를 가졌으면 통과
  const accepted = ALL_SCOPES.filter((s) =>
    expandScopes([s]).includes(scope)
  );
  const { data: grant } = await supabase
    .from("tenant_admin_grants")
    .select("id")
    .eq("user_id", user.id)
    .in("scope", accepted)
    .is("revoked_at", null)
    .maybeSingle();

  if (!grant) {
    const message = `${ADMIN_SCOPE_LABELS[scope]} 관리 권한이 없습니다.`;
    // 모니터링 창이 열려 있으면 피드에 자동 기록 (규칙 거부 가시화)
    await recordActionDenial({ kind: `scope:${scope}`, message });
    return { ok: false, error: message };
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

/**
 * 보안 기록 열람 권한 — DB의 app.can_view_security()와 같은 기준.
 *
 * 대표 또는 audit 위임자(= 기업 보안책임자). 주민번호 '조회' 권한이 아니라
 * 조회 이력을 '읽는' 권한이다. 두 권한은 별개로 부여된다 (CLAUDE.md §5).
 */
export async function canViewSecurity(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const role = roleFromUser(user);
  if (role === "platform_admin" || role === "org_admin") return true;

  const scopes = await getAdminScopes();
  return scopes.audit;
}

/**
 * 지급(금액) 권한 — DB의 app.can_manage_payments()와 같은 기준.
 *
 * 지급은 직급 축만으로 가를 수 없다. '재무를 맡은 대리'는 금액을 봐야 하고,
 * '지급과 무관한 팀장'은 볼 이유가 없다. 그래서 대표·이사는 기본 포함하고
 * 그 밖에는 finance 위임으로 연다.
 *
 * 이 권한은 **금액**에 한정된다. 주민등록번호 조회는 포함되지 않는다 —
 * 그건 tax_access_grants 지정자만 가능하며 위임 대상이 아니다 (CLAUDE.md §5).
 */
export async function canManagePayments(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const role = roleFromUser(user);
  if (role === "platform_admin") return true;

  const grade = gradeFromUser(user);
  if (grade && gradeAtLeast(grade, "director")) return true;

  const scopes = await getAdminScopes();
  return scopes.finance;
}

/** 지급 관련 서버 액션의 진입 가드. */
export async function requirePaymentsAccess(): Promise<
  { ok: true; userId: string; tenantId: string; role: string } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canManagePayments())) {
    return {
      ok: false,
      error:
        "지급 권한이 없습니다. 대표·이사이거나 ‘지급·정산’ 관리 권한을 위임받아야 합니다.",
    };
  }
  return { ok: true, userId: user.id, tenantId, role };
}
