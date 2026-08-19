"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { refreshAcceptanceSignatureSnapshot } from "@/lib/integrations/acceptance";
import { refreshProjectEngagementStage } from "@/lib/integrations/project-engagement";
import { registerExpertSignature } from "@/app/(expert)/expert/profile/signature-actions";

export type SignResult = { ok: true } | { ok: false; error: string };

/**
 * 전문가의 '수락서 정보 확인 완료 및 승인(서명)'.
 *
 * 이 한 번의 동작으로 세 가지가 함께 일어난다:
 *  1. 그 자리에서 그린 서명이 있으면 내 서명으로 등록되고(다음부터 자동 배치),
 *  2. 수락서 문서에 서명이 박히고,
 *  3. 수락서가 **확정**된다.
 *
 * 확정을 전문가 승인으로 끝내는 이유: 계약 성립의 최종 확인 주체는 전문가다.
 * 기업 담당자가 한 번 더 눌러야 확정된다면, 전문가 화면에는 '내가 승인했는데
 * 아직 확정이 아닌' 상태가 남는다 — 무엇을 더 기다려야 하는지 알 수 없다.
 *
 * 전원이 승인하면 프로젝트가 자동으로 '확정' 단계로 올라간다.
 */
export async function signAcceptance(
  acceptanceId: string,
  input?: { dataUrl?: string; kind?: "signature" | "seal" }
): Promise<SignResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가 프로필이 없습니다." };

  const admin = createAdminClient();
  const { data: acceptance } = await admin
    .from("engagement_acceptances")
    .select("id, tenant_id, expert_id, engagement_id, status, has_signature")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance || acceptance.expert_id !== expert.id) {
    return { ok: false, error: "본인의 수락서만 승인할 수 있습니다." };
  }
  if (acceptance.status === "confirmed") {
    return { ok: false, error: "이미 승인이 완료된 수락서입니다." };
  }

  // 그 자리에서 그린 서명 — 내 서명으로 등록한다(형식·용량 검증은 등록 액션이 한다)
  if (input?.dataUrl) {
    const registered = await registerExpertSignature(
      input.kind ?? "signature",
      input.dataUrl
    );
    if (!registered.ok) return registered;
  }

  // 수락서에 서명이 아직 안 박혔으면 지금 박는다
  const hasSignature =
    acceptance.has_signature || (await refreshAcceptanceSignatureSnapshot(acceptanceId));
  if (!hasSignature) {
    return {
      ok: false,
      error:
        "서명이 없습니다. 아래 칸에 서명을 그리거나 내 프로필에서 서명을 등록해 주세요.",
    };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("engagement_acceptances")
    .update({ status: "confirmed", signed_at: now, confirmed_at: now })
    .eq("id", acceptanceId)
    .neq("status", "confirmed");
  if (error) return { ok: false, error: "승인 처리에 실패했습니다." };

  await admin.from("audit_logs").insert({
    tenant_id: acceptance.tenant_id,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "engagement_acceptance.confirm",
    resource_type: "engagement_acceptance",
    resource_id: acceptanceId,
  });

  // 프로젝트 단계 재판정 — 전원 승인이면 '확정'으로 올라간다
  const { data: engagement } = await admin
    .from("expert_engagements")
    .select("project_id")
    .eq("id", acceptance.engagement_id)
    .maybeSingle();
  if (engagement?.project_id) {
    await refreshProjectEngagementStage(engagement.project_id);
  }

  revalidatePath(`/expert/engagements/${acceptance.engagement_id}/acceptance`);
  revalidatePath("/expert/engagements");
  return { ok: true };
}
