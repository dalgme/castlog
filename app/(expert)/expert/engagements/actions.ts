"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { applyEngagementResponse } from "@/lib/integrations/engagements";
import {
  engagementRespondSchema,
  type EngagementRespondInput,
} from "@/lib/integrations/schemas";

export type PortalRespondResult = { ok: true } | { ok: false; error: string };

/** 전문가 포털에서의 섭외 응답 (로그인 상태 — RLS 본인 검증 후 공통 처리) */
export async function respondEngagementAsExpert(
  engagementId: string,
  input: EngagementRespondInput
): Promise<PortalRespondResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = engagementRespondSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  // RLS(is_expert_self)가 본인 건만 돌려준다 — 조회 성공 = 본인 확인
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, token_expires_at")
    .eq("id", engagementId)
    .maybeSingle();

  if (!engagement) {
    return { ok: false, error: "섭외 요청을 찾을 수 없습니다." };
  }
  if (engagement.status !== "requested") {
    return { ok: false, error: "이미 처리된 섭외 요청입니다." };
  }
  if (new Date(engagement.token_expires_at).getTime() < Date.now()) {
    return { ok: false, error: "응답 기한이 지난 섭외 요청입니다." };
  }

  const result = await applyEngagementResponse(
    engagement.id,
    parsed.data.decision,
    parsed.data.responseNote || null,
    user.id
  );
  if (!result.ok) return result;

  revalidatePath("/expert/engagements");
  return { ok: true };
}
