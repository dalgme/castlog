"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";

/**
 * 세션 분야 마스터 (기획 확정 2026-08-30 — 35번).
 * 자사 직원 **누구나** 추가하면 전 직원이 공통으로 사용한다 (행사·컨설팅
 * 세션의 분야 선택지). 정리(비활성)는 설정 스코프 — 오타·중복 관리는 관리 행위.
 */

export type FieldResult = { ok: true } | { ok: false; error: string };

export async function addSessionField(name: string): Promise<FieldResult> {
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
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "분야 이름을 입력하세요." };
  if (trimmed.length > 50) {
    return { ok: false, error: "분야 이름은 50자 이내로 입력하세요." };
  }

  const { error } = await supabase.from("tenant_session_fields").insert({
    tenant_id: tenantId,
    name: trimmed,
    created_by: user.id,
  });
  if (error) {
    // unique(tenant_id, name) 충돌 = 이미 있는 분야 (규칙)
    if (error.code === "23505") {
      return { ok: false, error: `'${trimmed}' 분야는 이미 등록되어 있습니다.` };
    }
    return {
      ok: false,
      error: await explainActionError(error.message, "분야 추가에 실패했습니다."),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "session_field.add",
    resource_type: "tenant_session_field",
    after_data: { name: trimmed },
  });

  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true };
}

/** 분야 비활성화 — 설정 스코프 (기존 세션의 연결은 유지된다) */
export async function deactivateSessionField(id: string): Promise<FieldResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const gate = await requireAdminScope("settings");
  if (!gate.ok) {
    return {
      ok: false,
      error: "분야 정리(비활성)는 대표 또는 '회사 설정' 위임자만 할 수 있습니다 (권한 규칙). 추가는 누구나 가능합니다.",
    };
  }

  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("tenant_session_fields")
    .update({ is_active: false })
    .eq("id", id)
    .eq("is_active", true)
    .select("id, name")
    .maybeSingle();
  if (error || !updated) {
    return { ok: false, error: "분야 비활성화에 실패했습니다. 새로고침 후 다시 시도해 주세요." };
  }

  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true };
}
