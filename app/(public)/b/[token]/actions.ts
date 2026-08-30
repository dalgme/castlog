"use server";

import { z } from "zod";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  respondEngagementBundleByToken,
  type BundleRespondResult,
} from "@/lib/integrations/engagement-bundles";

const bundleRespondSchema = z.object({
  decisions: z
    .array(
      z.object({
        engagementId: z.string().uuid(),
        decision: z.enum(["accepted", "declined"]),
      })
    )
    .min(1, "응답할 건이 없습니다.")
    .max(100),
  responseNote: z.string().max(1000, "의견은 1000자 이내로 입력하세요.").optional(),
});
export type BundleRespondInput = z.infer<typeof bundleRespondSchema>;

/** 공개 /b 묶음 섭외 일괄 회신 — 토큰이 곧 인증 수단 (service_role 처리) */
export async function respondToEngagementBundle(
  token: string,
  input: BundleRespondInput
): Promise<BundleRespondResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const parsed = bundleRespondSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  return respondEngagementBundleByToken(
    token,
    parsed.data.decisions,
    parsed.data.responseNote || null
  );
}
