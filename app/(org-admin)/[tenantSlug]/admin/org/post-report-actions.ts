"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { roleFromUser } from "@/lib/auth/tenant";
import { isUserGrade } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import {
  POST_REPORT_FLAG,
  parsePostReportSettings,
} from "@/lib/integrations/engagement-post-report";

export type PostReportActionResult = { ok: true } | { ok: false; error: string };

/**
 * 섭외 사후보고 모드 설정 (기획 확정 2026-08-30 — 38번).
 * 결재 흐름을 바꾸는 설정이라 approvals 스코프(대표 + '전결규정' 위임자)로 게이트.
 * 값은 tenants.feature_flags.engagement_post_report — 개정은 감사로그에 남긴다(§14-5).
 */
export async function setPostReportSettings(input: {
  enabled: boolean;
  minGrade: string;
  maxAmount: number | null;
}): Promise<PostReportActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireAdminScope("approvals");
  if (!gate.ok) {
    return {
      ok: false,
      error: "사후보고 모드 설정 권한이 없습니다 (권한 규칙 — 대표 또는 '전결규정' 위임자).",
    };
  }
  const modules = await getTenantModules();
  if (!modules.approvals) {
    return { ok: false, error: "전자결재 모듈이 꺼진 회사에는 사후보고 모드가 필요 없습니다 (품의 없이 진행됩니다)." };
  }
  if (!isUserGrade(input.minGrade)) {
    return { ok: false, error: "최소 직급 값을 확인하세요." };
  }
  if (
    input.maxAmount !== null &&
    (!Number.isFinite(input.maxAmount) || input.maxAmount < 0 || input.maxAmount > 999_999_999_999)
  ) {
    return { ok: false, error: "금액 상한은 0 이상 12자리 이내의 숫자로 입력하세요." };
  }

  const admin = createAdminClient();
  // 읽기-수정-쓰기 경합 방지 — 다른 feature_flags 쓰기와 겹칠 수 있다 (CAS 3회)
  let saved = false;
  let before: { enabled: boolean; min_grade: string; max_amount: number | null } | null =
    null;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags, updated_at")
      .eq("id", gate.tenantId)
      .maybeSingle();
    if (!tenant) return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };
    const priorFlags =
      tenant.feature_flags !== null &&
      typeof tenant.feature_flags === "object" &&
      !Array.isArray(tenant.feature_flags)
        ? (tenant.feature_flags as Record<string, unknown>)
        : {};
    const prior = parsePostReportSettings(priorFlags);
    before = {
      enabled: prior.enabled,
      min_grade: prior.minGrade,
      max_amount: prior.maxAmount,
    };
    let updateQuery = admin
      .from("tenants")
      .update({
        feature_flags: {
          ...priorFlags,
          [POST_REPORT_FLAG]: {
            enabled: input.enabled,
            min_grade: input.minGrade,
            max_amount: input.maxAmount,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", gate.tenantId);
    updateQuery = tenant.updated_at
      ? updateQuery.eq("updated_at", tenant.updated_at)
      : updateQuery.is("updated_at", null);
    const { data: updated, error } = await updateQuery.select("id");
    if (error) {
      return { ok: false, error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
    }
    saved = (updated ?? []).length > 0;
  }
  if (!saved) {
    return { ok: false, error: "다른 설정 변경과 겹쳤습니다. 새로고침 후 다시 시도해 주세요." };
  }

  const {
    data: { user: actor },
  } = await createClient().auth.getUser();
  await admin.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: roleFromUser(actor) ?? "staff",
    action: "tenant.post_report_mode",
    resource_type: "tenant",
    resource_id: gate.tenantId,
    before_data: before,
    after_data: {
      enabled: input.enabled,
      min_grade: input.minGrade,
      max_amount: input.maxAmount,
    },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
