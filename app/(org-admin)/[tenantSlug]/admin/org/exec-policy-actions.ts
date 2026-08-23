"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { isUserGrade } from "@/lib/auth/grades";
import { EXEC_FEATURES, type ExecFeature } from "@/lib/auth/exec-permissions";
import { explainActionError } from "@/lib/ux/action-errors";

export type ExecPolicyActionResult = { ok: true } | { ok: false; error: string };

function isExecFeature(value: unknown): value is ExecFeature {
  return typeof value === "string" && value in EXEC_FEATURES;
}

/**
 * 기능별 권한 문턱 조정 (기획 확정 2026-08-23 — 차등화 다음 단계).
 * 임직원 권한 구조를 다루므로 staff 스코프(대표 + '임직원 계정' 위임자)로 게이트.
 * 값은 tenant_exec_overrides / tenant_exec_grants — RLS도 같은 스코프로 지킨다.
 */

/** 기능의 최소 레벨 조정 — minGrade가 null이면 기본값으로 복귀(행 삭제) */
export async function setExecThreshold(
  feature: string,
  minGrade: string | null
): Promise<ExecPolicyActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  if (!isExecFeature(feature)) {
    return { ok: false, error: "알 수 없는 기능입니다." };
  }
  if (minGrade !== null && !isUserGrade(minGrade)) {
    return { ok: false, error: "레벨 값을 확인하세요." };
  }

  const supabase = createClient();
  if (minGrade === null) {
    const { error } = await supabase
      .from("tenant_exec_overrides")
      .delete()
      .eq("tenant_id", session.tenantId)
      .eq("feature", feature);
    if (error) {
      return {
        ok: false,
        error: await explainActionError(error.message, "기본값 복귀에 실패했습니다."),
      };
    }
  } else {
    const { error } = await supabase.from("tenant_exec_overrides").upsert(
      {
        tenant_id: session.tenantId,
        feature,
        min_grade: minGrade,
        updated_by: session.userId,
      },
      { onConflict: "tenant_id,feature" }
    );
    if (error) {
      return {
        ok: false,
        error: await explainActionError(error.message, "문턱 조정에 실패했습니다."),
      };
    }
  }

  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "tenant.exec_threshold_change",
    resource_type: "tenant",
    resource_id: session.tenantId,
    after_data: { feature, min_grade: minGrade ?? "(기본값)" },
  });

  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/** 특정 직원에게 기능을 레벨과 무관하게 열어준다 */
export async function addExecGrant(
  feature: string,
  userId: string
): Promise<ExecPolicyActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  if (!isExecFeature(feature)) {
    return { ok: false, error: "알 수 없는 기능입니다." };
  }

  const supabase = createClient();
  // 같은 테넌트의 활성 직원만 (RLS + 명시 확인)
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId || !target.is_active) {
    return { ok: false, error: "같은 기업의 활성 직원만 지정할 수 있습니다." };
  }

  const { error } = await supabase.from("tenant_exec_grants").upsert(
    {
      tenant_id: session.tenantId,
      feature,
      user_id: userId,
      created_by: session.userId,
    },
    { onConflict: "tenant_id,feature,user_id", ignoreDuplicates: true }
  );
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "지정에 실패했습니다."),
    };
  }

  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.exec_grant",
    resource_type: "user",
    resource_id: userId,
    after_data: { feature },
  });

  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/** 개인 지정 해제 */
export async function removeExecGrant(
  feature: string,
  userId: string
): Promise<ExecPolicyActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  if (!isExecFeature(feature)) {
    return { ok: false, error: "알 수 없는 기능입니다." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("tenant_exec_grants")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("feature", feature)
    .eq("user_id", userId);
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "해제에 실패했습니다."),
    };
  }

  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.exec_revoke",
    resource_type: "user",
    resource_id: userId,
    after_data: { feature },
  });

  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}
