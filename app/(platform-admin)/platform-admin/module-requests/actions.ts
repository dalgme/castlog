"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import { parseModuleFlags, MODULE_KEYS } from "@/lib/modules/modules";
import {
  isModuleRequestStatus,
  parseRequestedModules,
  type ModuleRequest,
} from "@/lib/modules/requests";

/**
 * 모듈 추가 요청 처리 (캐스트로그 관리모드 전용).
 *
 * 승인은 여기서만 일어난다 — 기업이 status를 직접 바꿔 스스로 켜지 못하도록,
 * feature_flags 반영은 service_role로만 수행하고 플랫폼관리자 세션을 검증한다.
 * 모듈을 켜도 기존 데이터는 그대로다(게이트는 앱 레벨, RLS는 tenant_id 기준).
 */

async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}

export async function listModuleRequests(): Promise<ModuleRequest[]> {
  if (!hasSupabaseEnv()) return [];
  const session = await requirePlatformAdmin();
  if (!session.ok) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_module_requests")
    .select(
      "id, tenant_id, requested_modules, note, status, requested_by, decision_note, created_at, decided_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id)));
  const requesterIds = Array.from(
    new Set(rows.map((r) => r.requested_by).filter((v): v is string => !!v))
  );

  const [{ data: tenants }, { data: requesters }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, slug, feature_flags")
      .in("id", tenantIds),
    requesterIds.length > 0
      ? admin.from("users").select("id, name").in("id", requesterIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const requesterById = new Map((requesters ?? []).map((u) => [u.id, u.name]));

  return rows.map((r) => {
    const tenant = tenantById.get(r.tenant_id);
    const flags = parseModuleFlags(tenant?.feature_flags ?? null);
    return {
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: tenant?.name ?? "(삭제된 테넌트)",
      tenantSlug: tenant?.slug ?? "-",
      requested: parseRequestedModules(r.requested_modules),
      current: MODULE_KEYS.filter((k) => flags[k]),
      note: r.note,
      status: isModuleRequestStatus(r.status) ? r.status : "pending",
      requesterName: r.requested_by
        ? requesterById.get(r.requested_by) ?? null
        : null,
      decisionNote: r.decision_note,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    };
  });
}

export type DecisionResult = { ok: true } | { ok: false; error: string };

/**
 * 요청 승인 — feature_flags에 요청 모듈을 켜고, 변경 시각을 남긴다.
 * 변경 시각은 기업 화면의 '무엇이 새로 열렸는지' 안내 노출 판정에 쓰인다.
 */
export async function approveModuleRequest(
  requestId: string,
  decisionNote: string
): Promise<DecisionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requirePlatformAdmin();
  if (!session.ok) return session;

  const admin = createAdminClient();

  const { data: request } = await admin
    .from("tenant_module_requests")
    .select("id, tenant_id, requested_modules, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (request.status !== "pending") {
    return { ok: false, error: "이미 처리된 요청입니다." };
  }

  const wanted = parseRequestedModules(request.requested_modules);
  if (wanted.length === 0) {
    return { ok: false, error: "요청된 기능이 없습니다." };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, feature_flags")
    .eq("id", request.tenant_id)
    .maybeSingle();
  if (!tenant) return { ok: false, error: "테넌트를 찾을 수 없습니다." };

  const currentFlags =
    tenant.feature_flags &&
    typeof tenant.feature_flags === "object" &&
    !Array.isArray(tenant.feature_flags)
      ? tenant.feature_flags
      : {};
  const modules = parseModuleFlags(tenant.feature_flags);
  for (const key of wanted) modules[key] = true;

  const { error: tenantError } = await admin
    .from("tenants")
    .update({
      feature_flags: { ...currentFlags, modules },
      modules_changed_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);
  if (tenantError) {
    return { ok: false, error: "모듈 활성화에 실패했습니다." };
  }

  await admin
    .from("tenant_module_requests")
    .update({
      status: "approved",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote.trim() || null,
    })
    .eq("id", requestId);

  await admin.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action: "module_request.approve",
    resource_type: "tenant",
    resource_id: tenant.id,
    before_data: { feature_flags: currentFlags },
    after_data: { modules, approved: wanted },
  });

  revalidatePath("/platform-admin/module-requests");
  revalidatePath("/platform-admin");
  return { ok: true };
}

/** 요청 거절 — 사유를 남긴다. 삭제하지 않고 상태로 보존한다(§14-4). */
export async function rejectModuleRequest(
  requestId: string,
  decisionNote: string
): Promise<DecisionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requirePlatformAdmin();
  if (!session.ok) return session;

  const note = decisionNote.trim();
  if (!note) return { ok: false, error: "거절 사유를 입력하세요." };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("tenant_module_requests")
    .update({
      status: "rejected",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id, tenant_id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "처리할 수 있는 요청이 없습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: updated.tenant_id,
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action: "module_request.reject",
    resource_type: "tenant",
    resource_id: updated.tenant_id,
    after_data: { note },
  });

  revalidatePath("/platform-admin/module-requests");
  return { ok: true };
}
