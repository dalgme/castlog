"use server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildRewrapContext,
  saveRewrapResult,
  type RewrapContext,
  type RewrapSubmitResult,
} from "@/lib/integrations/rrn-rewrap";

/**
 * 포털(로그인 세션) 기반 주민번호 키 전달 — 묶음 수락·화면을 닫은 전문가의
 * 정식 경로 (E2E 검수 전문가 P1-2). 본인 섭외 건인지 세션으로 확인한다.
 */
async function ownEngagement(engagementId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) return null;
  const { data: eng } = await createAdminClient()
    .from("expert_engagements")
    .select("id, expert_id, tenant_id, project_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.expert_id !== expert.id) return null;
  return eng;
}

export async function getPortalRewrapContext(
  engagementId: string
): Promise<RewrapContext> {
  if (!hasSupabaseEnv()) return { applicable: false };
  const eng = await ownEngagement(engagementId);
  if (!eng) return { applicable: false };
  return buildRewrapContext(eng);
}

export async function submitPortalRewrap(
  engagementId: string,
  input: { frontId: string; newWrappedDek: string }
): Promise<RewrapSubmitResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const eng = await ownEngagement(engagementId);
  if (!eng) return { ok: false, error: "본인의 섭외 건만 처리할 수 있습니다." };
  return saveRewrapResult(eng, input);
}
