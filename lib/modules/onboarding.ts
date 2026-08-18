import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/auth/session";
import { tenantIdFromUser } from "@/lib/auth/tenant";

import { MODULE_KEYS, parseModuleFlags, type ModuleKey } from "./modules";

/**
 * 아직 확인하지 않은 '새로 켜진 모듈' 안내 대상.
 *
 * 판정 기준: 테넌트의 modules_changed_at이 있고, 그 모듈이 켜져 있으며,
 * 이 사용자가 아직 확인(ack)하지 않았다. 모듈 변경 이력을 따로 쌓지 않으므로
 * '언제 켜졌는지'는 테넌트 단위 시각 하나로 판정한다 — 여러 모듈을 함께 켜는
 * 게 보통이라 이 정도로 충분하다.
 *
 * 처음부터 전부 켜고 시작한 테넌트(modules_changed_at이 null)에는 뜨지 않는다.
 */
export async function getPendingModuleOnboarding(): Promise<ModuleKey[]> {
  if (!hasSupabaseEnv()) return [];

  const user = await getSessionUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return [];

  const supabase = createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("feature_flags, modules_changed_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant?.modules_changed_at) return [];

  const modules = parseModuleFlags(tenant.feature_flags);
  const active = MODULE_KEYS.filter((key) => modules[key]);
  if (active.length === 0) return [];

  const { data: acks } = await supabase
    .from("module_onboarding_acks")
    .select("module_key")
    .eq("user_id", user.id);

  const acked = new Set((acks ?? []).map((a) => a.module_key));
  return active.filter((key) => !acked.has(key));
}
