"use server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  applyEngagementResponse,
  lookupEngagementByToken,
} from "@/lib/integrations/engagements";
import {
  engagementRespondSchema,
  type EngagementRespondInput,
} from "@/lib/integrations/schemas";

export type RespondResult =
  | { ok: true; decision: "accepted" | "declined" }
  | { ok: false; error: string };

/** 공개 /e 섭외 응답 — 토큰이 곧 인증 수단 (로그인 불필요, service_role 처리) */
export async function respondToEngagementByToken(
  token: string,
  input: EngagementRespondInput
): Promise<RespondResult> {
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

  const lookup = await lookupEngagementByToken(token);
  if (!lookup.ok) {
    return { ok: false, error: "유효하지 않거나 만료된 섭외 링크입니다." };
  }

  const result = await applyEngagementResponse(
    lookup.engagement.id,
    parsed.data.decision,
    parsed.data.responseNote || null,
    null // 공개 링크 응답 — 세션 없음
  );

  if (!result.ok) return result;
  return { ok: true, decision: parsed.data.decision };
}
