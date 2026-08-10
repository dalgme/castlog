"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { generateLinkToken, hashLinkToken } from "@/lib/auth/tokens";
import { buildPublicLink } from "@/lib/routing/links";
import {
  engagementCreateSchema,
  type EngagementCreateInput,
} from "@/lib/integrations/schemas";
import { ENGAGEMENT_EXPIRES_DAYS } from "@/lib/integrations/engagements";

export type CreateEngagementResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * 섭외 요청 생성 (experts ↔ operations 연동 — CLAUDE.md 1-2-6)
 * 활성 연결이 있는 전문가만 대상. 동의는 공개 /e 링크로 받는다 (업무연락).
 * SMS 발송은 단계 14 — 지금은 링크를 복사해 직접 전달한다.
 */
export async function createEngagement(
  input: EngagementCreateInput
): Promise<CreateEngagementResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }

  const parsed = engagementCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  // 프로젝트 연결은 operations 모듈 활성 시에만 (연동 규칙)
  let projectId: string | null = null;
  if (data.projectId) {
    if (!modules.operations) {
      return { ok: false, error: "프로젝트 모듈이 비활성 상태입니다." };
    }
    projectId = data.projectId;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "섭외 요청 권한이 없습니다." };
  }

  // 활성 연결이 있는 전문가만 (RLS + 명시 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("id, status")
    .eq("expert_id", data.expertId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!link || link.status !== "active") {
    return { ok: false, error: "활성 연결이 있는 전문가만 섭외할 수 있습니다." };
  }

  const token = generateLinkToken();
  const { data: engagement, error } = await supabase
    .from("expert_engagements")
    .insert({
      tenant_id: tenantId,
      expert_id: data.expertId,
      project_id: projectId,
      role_description: data.roleDescription,
      message: data.message || null,
      fee_amount: data.feeAmount ? parseInt(data.feeAmount, 10) : null,
      starts_on: data.startsOn || null,
      ends_on: data.endsOn || null,
      token_hash: hashLinkToken(token),
      token_expires_at: new Date(
        Date.now() + ENGAGEMENT_EXPIRES_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      requested_by: user.id,
    })
    .select("id")
    .single();

  if (error || !engagement) {
    return { ok: false, error: "섭외 요청 생성에 실패했습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "engagement.request",
    resource_type: "expert_engagement",
    resource_id: engagement.id,
    after_data: { expert_id: data.expertId, project_id: projectId },
  });

  let url: string;
  try {
    url = buildPublicLink("engagementConsent", token);
  } catch {
    url = `/e/${token}`;
  }

  revalidatePath("/[tenantSlug]/experts", "page");
  if (projectId) {
    revalidatePath(`/[tenantSlug]/projects/${projectId}`, "page");
  }
  return { ok: true, url };
}

export type EngagementActionResult = { ok: true } | { ok: false; error: string };

/**
 * 섭외 취소 (단계 29 — 대표 피드백 ③)
 *  - 회수(requested): 전문가 응답 전 요청 회수. 사유 선택.
 *  - 긴급 취소(accepted): 계약 성립 후 취소. 사유 필수 + 전사 긴급 알림 발생.
 * 두 경우 모두 취소 내역(engagement_cancellations)에 기록한다.
 */
export async function cancelEngagement(
  engagementId: string,
  reason?: string
): Promise<EngagementActionResult> {
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
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "섭외 취소 권한이 없습니다." };
  }

  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, expert_id, project_id, experts (name)")
    .eq("id", engagementId)
    .maybeSingle();

  if (
    !engagement ||
    !["requested", "accepted"].includes(engagement.status)
  ) {
    return { ok: false, error: "취소할 수 없는 섭외입니다." };
  }

  const urgent = engagement.status === "accepted";
  const trimmedReason = reason?.trim() || null;
  if (urgent && !trimmedReason) {
    return {
      ok: false,
      error: "계약 성립 후 긴급 취소는 사유 입력이 필수입니다.",
    };
  }

  // 상태 전환 (경합 방지 — 조회 시점 상태를 그대로 가드)
  const { data: updated, error } = await supabase
    .from("expert_engagements")
    .update({ status: "canceled" })
    .eq("id", engagementId)
    .eq("status", engagement.status)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "이미 처리되어 취소할 수 없습니다." };
  }

  // 취소 내역 기록
  await supabase.from("engagement_cancellations").insert({
    tenant_id: tenantId,
    engagement_id: engagementId,
    expert_id: engagement.expert_id,
    project_id: engagement.project_id,
    prior_status: engagement.status,
    is_urgent: urgent,
    reason: trimmedReason,
    canceled_by: user.id,
  });

  // 긴급 취소 → 전사 알림 (대시보드 배너)
  if (urgent) {
    const expertName = engagement.experts?.name ?? "전문가";
    await supabase.from("tenant_alerts").insert({
      tenant_id: tenantId,
      severity: "urgent",
      category: "engagement_cancel",
      title: `긴급: 섭외 취소 (${expertName})`,
      body: `계약 성립된 섭외가 취소되었습니다. 사유: ${trimmedReason}`,
      resource_type: "expert_engagement",
      resource_id: engagementId,
      created_by: user.id,
    });
  }

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: urgent ? "engagement.urgent_cancel" : "engagement.cancel",
    resource_type: "expert_engagement",
    resource_id: engagementId,
    after_data: { prior_status: engagement.status, is_urgent: urgent },
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  if (engagement.project_id) {
    revalidatePath(`/[tenantSlug]/projects/${engagement.project_id}`, "page");
  }
  return { ok: true };
}
