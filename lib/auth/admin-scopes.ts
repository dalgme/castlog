import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import { gradeFromUser, roleFromUser, tenantIdFromUser } from "./tenant";
import { gradeAtLeast } from "./grades";
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
  finance: false,
};

const ALL: AdminScopeSet = {
  settings: true,
  staff: true,
  sending: true,
  audit: true,
  finance: true,
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
    return role === "platform_admin" ? { ...ALL } : { ...NONE };
  }
  if (role === "org_admin") return { ...ALL };
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
