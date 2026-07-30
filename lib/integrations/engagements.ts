import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import { parseModuleFlags } from "@/lib/modules/modules";
import type { Tables } from "@/lib/supabase/database.types";

/**
 * 전문가 섭외 연동 로직 (experts ↔ operations — CLAUDE.md 1-2-6)
 *
 * 연동 로직은 이 모듈(lib/integrations/)에 격리한다.
 * 섭외 승인 = 계약 성립 — Phase 2에서 이 시점에 주민번호 키 위임
 * (tax_project_grants 래핑)이 발생한다. 훅 위치를 여기에 둔다.
 */

export const ENGAGEMENT_EXPIRES_DAYS = 14;

export const ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  requested: "요청됨",
  accepted: "수락(계약 성립)",
  declined: "거절",
  canceled: "회수",
  expired: "만료",
};

export type EngagementLookup =
  | {
      ok: true;
      engagement: Tables<"expert_engagements">;
      tenantName: string;
      projectName: string | null;
      expertName: string;
    }
  | { ok: false; reason: "not_found" | "expired" | "already_responded" | "canceled" };

/**
 * 공개 /e/{token} 검증 — service_role 전용 (anon RLS 정책 없음).
 * 모듈 게이트: 테넌트의 experts 모듈이 꺼져 있으면 연결 테이블 접근도 차단.
 */
export async function lookupEngagementByToken(
  token: string
): Promise<EngagementLookup> {
  const admin = createAdminClient();

  const { data: engagement } = await admin
    .from("expert_engagements")
    .select("*")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();

  if (!engagement) return { ok: false, reason: "not_found" };

  // 모듈 비활성 시 접근 차단 (CLAUDE.md 1-2-6 연동 규칙)
  const { data: tenant } = await admin
    .from("tenants")
    .select("name, feature_flags")
    .eq("id", engagement.tenant_id)
    .maybeSingle();
  const modules = parseModuleFlags(tenant?.feature_flags);
  if (!modules.experts) return { ok: false, reason: "not_found" };

  if (engagement.status === "canceled") return { ok: false, reason: "canceled" };
  if (engagement.status !== "requested") {
    return { ok: false, reason: "already_responded" };
  }
  if (new Date(engagement.token_expires_at).getTime() < Date.now()) {
    await admin
      .from("expert_engagements")
      .update({ status: "expired" })
      .eq("id", engagement.id)
      .eq("status", "requested");
    return { ok: false, reason: "expired" };
  }

  const [{ data: project }, { data: expert }] = await Promise.all([
    engagement.project_id
      ? admin
          .from("projects")
          .select("name")
          .eq("id", engagement.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("experts").select("name").eq("id", engagement.expert_id).maybeSingle(),
  ]);

  return {
    ok: true,
    engagement,
    tenantName: tenant?.name ?? "",
    projectName: project?.name ?? null,
    expertName: expert?.name ?? "",
  };
}

/**
 * 섭외 응답 공통 처리 (공개 링크·포털 공용) — service_role.
 * 수락 = 계약 성립. Phase 2: 여기서 tax_project_grants 래핑을 생성한다.
 */
export async function applyEngagementResponse(
  engagementId: string,
  decision: "accepted" | "declined",
  responseNote: string | null,
  actorAuthUserId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("expert_engagements")
    .update({
      status: decision,
      responded_at: new Date().toISOString(),
      response_note: responseNote,
    })
    .eq("id", engagementId)
    .eq("status", "requested")
    .select("id, tenant_id, expert_id, project_id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "이미 처리되었거나 응답할 수 없는 요청입니다." };
  }

  // Phase 2 훅: decision === 'accepted' 시점에 해당 프로젝트·기업 권한자용
  // 주민번호 키 래핑(tax_project_grants)을 생성한다 (설계문서 4.4).

  await admin.from("audit_logs").insert({
    tenant_id: updated.tenant_id,
    actor_auth_user_id: actorAuthUserId,
    actor_role: "expert",
    action:
      decision === "accepted" ? "engagement.accept" : "engagement.decline",
    resource_type: "expert_engagement",
    resource_id: updated.id,
    after_data: { project_id: updated.project_id },
  });

  return { ok: true };
}
