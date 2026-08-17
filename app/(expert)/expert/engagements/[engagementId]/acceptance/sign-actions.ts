"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type SignResult = { ok: true } | { ok: false; error: string };

/**
 * 전문가 확인 및 전자서명 (Phase A-3).
 * 수락서에는 이미 등록된 서명·날인이 스냅샷되어 있고, 여기서는 전문가가
 * 최종 내용을 확인했다는 사실(서명 시각)을 기록한다. 서명 이미지가 없으면
 * 프로필에서 먼저 등록하도록 안내한다.
 */
export async function signAcceptance(acceptanceId: string): Promise<SignResult> {
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
    .select("id, expert_id, engagement_id, status, has_signature")
    .eq("id", acceptanceId)
    .maybeSingle();
  if (!acceptance || acceptance.expert_id !== expert.id) {
    return { ok: false, error: "본인의 수락서만 서명할 수 있습니다." };
  }
  if (acceptance.status === "confirmed") {
    return { ok: false, error: "이미 확인이 완료된 수락서입니다." };
  }
  if (!acceptance.has_signature) {
    return {
      ok: false,
      error: "등록된 서명이 없습니다. 내 프로필에서 서명을 먼저 등록해 주세요.",
    };
  }

  const { error } = await admin
    .from("engagement_acceptances")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", acceptanceId);
  if (error) return { ok: false, error: "서명 처리에 실패했습니다." };

  await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: user.id,
    actor_role: "expert",
    action: "engagement_acceptance.sign",
    resource_type: "engagement_acceptance",
    resource_id: acceptanceId,
  });

  revalidatePath(`/expert/engagements/${acceptance.engagement_id}/acceptance`);
  return { ok: true };
}
