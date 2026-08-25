"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { roleFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  parseExpertsLite,
  type ModuleKey,
} from "@/lib/modules/modules";
import { parseRequestedModules } from "@/lib/modules/requests";

export type ModuleRequestResult = { ok: true } | { ok: false; error: string };

/** 감사로그의 actor_role — AdminScopeSession에는 role이 없어 세션에서 다시 읽는다. */
async function currentRole(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return roleFromUser(user) ?? "staff";
}

/**
 * 모듈 추가 요청 (기업 → 캐스트로그).
 *
 * 모듈 조합은 계약(플랜) 정보이므로 기업이 스스로 켤 수 없다. 요청만 남기고
 * 캐스트로그 관리모드에서 승인해야 feature_flags가 바뀐다. 결제 기능은 없다.
 */
export async function requestModules(
  moduleKeys: string[],
  note: string
): Promise<ModuleRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  // '사용 기능 요청'은 계약에 닿는 일이라 별도 스코프로 뗐다 (settings가 포함).
  const gate = await requireAdminScope("modules");
  if (!gate.ok) return { ok: false, error: gate.error };

  const wanted = moduleKeys.filter((k): k is ModuleKey =>
    (MODULE_KEYS as readonly string[]).includes(k)
  );
  // 3개 영역을 이미 다 쓰는 회사도 요청할 것이 있다(설정 범위·사용 방식 문의).
  // 그때는 고를 모듈이 없으므로 글로 받는다 — 대신 내용은 있어야 한다.
  if (wanted.length === 0 && note.trim().length < 5) {
    return {
      ok: false,
      error: "추가할 기능을 선택하거나, 요청 내용을 적어 주세요.",
    };
  }

  const current = await getTenantModules();
  const alreadyOn = wanted.filter((k) => current[k]);
  if (alreadyOn.length > 0) {
    return {
      ok: false,
      error: `${alreadyOn.map((k) => MODULE_LABELS[k]).join("·")}은(는) 이미 사용 중입니다.`,
    };
  }

  const supabase = createClient();

  // 대기 중인 요청이 이미 있으면 중복 상신을 막는다 (부분 유니크 인덱스도 있음)
  const { data: open } = await supabase
    .from("tenant_module_requests")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .maybeSingle();
  if (open) {
    return {
      ok: false,
      error: "이미 검토 중인 요청이 있습니다. 처리된 뒤에 다시 요청해 주세요.",
    };
  }

  const requestedModules: Record<string, boolean> = {};
  for (const key of wanted) requestedModules[key] = true;

  const { error } = await supabase.from("tenant_module_requests").insert({
    tenant_id: gate.tenantId,
    requested_modules: requestedModules,
    note: note.trim() || null,
    requested_by: gate.userId,
  });
  if (error) return { ok: false, error: "요청 저장에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: await currentRole(),
    action: "module_request.create",
    resource_type: "tenant",
    resource_id: gate.tenantId,
    after_data: { requested: wanted },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/**
 * 전문가 섭외 라이트 모드 켜기/끄기 (기획 확정 2026-08-25).
 *
 * 모듈 추가(계약)와 달리 **기능 축소**라 기업이 스스로 설정한다 — 캐스트로그
 * 승인이 필요 없다. 껐다 켜도 데이터는 그대로다(같은 상태 모델).
 * 스코프는 사용 기능과 같은 'modules'(settings가 포함).
 */
export async function setExpertsLite(
  enabled: boolean
): Promise<ModuleRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireAdminScope("modules");
  if (!gate.ok) return { ok: false, error: gate.error };

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("feature_flags")
    .eq("id", gate.tenantId)
    .maybeSingle();
  if (!tenant) return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };

  const current = parseExpertsLite(tenant.feature_flags);
  if (current === enabled) return { ok: true };

  // 기존 feature_flags(modules 등)를 보존하면서 experts_lite만 바꾼다
  const priorFlags =
    tenant.feature_flags !== null &&
    typeof tenant.feature_flags === "object" &&
    !Array.isArray(tenant.feature_flags)
      ? tenant.feature_flags
      : {};
  const { error } = await admin
    .from("tenants")
    .update({
      feature_flags: { ...priorFlags, experts_lite: enabled },
      updated_at: new Date().toISOString(),
    })
    .eq("id", gate.tenantId);
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: await currentRole(),
    action: enabled ? "tenant.experts_lite_on" : "tenant.experts_lite_off",
    resource_type: "tenant",
    resource_id: gate.tenantId,
    after_data: { experts_lite: enabled },
  });

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}

/** 검토 전인 자기 요청 취소. */
export async function cancelModuleRequest(
  requestId: string
): Promise<ModuleRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireAdminScope("modules");
  if (!gate.ok) return { ok: false, error: gate.error };

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("tenant_module_requests")
    .update({ status: "canceled" })
    .eq("id", requestId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id, requested_modules")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "취소할 수 있는 요청이 없습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: await currentRole(),
    action: "module_request.cancel",
    resource_type: "tenant",
    resource_id: gate.tenantId,
    after_data: { requested: parseRequestedModules(updated.requested_modules) },
  });

  revalidatePath("/[tenantSlug]/settings", "page");
  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 모듈 활성화 안내 배너 확인 처리 (사용자별). */
export async function ackModuleOnboarding(
  moduleKey: string
): Promise<ModuleRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!(MODULE_KEYS as readonly string[]).includes(moduleKey)) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const tenantId = user.app_metadata?.tenant_id;
  if (typeof tenantId !== "string") {
    return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };
  }

  const { error } = await supabase
    .from("module_onboarding_acks")
    .upsert(
      { tenant_id: tenantId, user_id: user.id, module_key: moduleKey },
      { onConflict: "user_id,module_key" }
    );
  if (error) return { ok: false, error: "처리에 실패했습니다." };

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}
