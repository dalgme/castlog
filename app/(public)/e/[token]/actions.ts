"use server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";
import {
  applyEngagementResponse,
  lookupEngagementByToken,
} from "@/lib/integrations/engagements";
import {
  engagementRespondSchema,
  type EngagementRespondInput,
} from "@/lib/integrations/schemas";
import {
  buildRewrapContext,
  saveRewrapResult,
  withinRewrapWindow,
  type RewrapContext,
  type RewrapSubmitResult,
} from "@/lib/integrations/rrn-rewrap";

export type { RewrapContext, RewrapSubmitResult };

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

/**
 * 공개 링크 경로의 재래핑 — 수락 직후 같은 화면에서만 의미가 있다.
 * 토큰은 문자로 전달되는 값이라 영구 인증 수단이 되면 안 된다: 응답 후
 * REWRAP_WINDOW_HOURS 안에서만 허용하고, 그 뒤에는 포털(로그인)로 안내한다
 * (E2E 검수 전문가 P2-1).
 */
async function engagementByToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("expert_engagements")
    .select("id, expert_id, tenant_id, project_id, status, responded_at")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();
  return data;
}

export async function getRewrapContext(token: string): Promise<RewrapContext> {
  if (!hasSupabaseEnv()) return { applicable: false };
  const eng = await engagementByToken(token);
  if (!eng || eng.status !== "accepted") return { applicable: false, reason: "not_accepted" };
  if (!withinRewrapWindow(eng.responded_at)) {
    return { applicable: false, reason: "window_closed" };
  }
  return buildRewrapContext(eng);
}

export async function submitRewrap(
  token: string,
  input: { frontId: string; newWrappedDek: string }
): Promise<RewrapSubmitResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const eng = await engagementByToken(token);
  if (!eng || eng.status !== "accepted") {
    return { ok: false, error: "유효한 승인 건이 아닙니다." };
  }
  if (!withinRewrapWindow(eng.responded_at)) {
    return {
      ok: false,
      error: "수락 후 시간이 지나 이 링크로는 키를 전달할 수 없습니다 (규칙). 전문가 포털에 로그인해 수락서 화면에서 전달해 주세요.",
    };
  }
  return saveRewrapResult(eng, input);
}
