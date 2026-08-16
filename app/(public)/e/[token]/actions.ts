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
 * 재래핑 컨텍스트 — 승인된 섭외 건에서, 전문가가 브라우저에서 DEK를 테넌트 키로
 * 다시 래핑하는 데 필요한 자료(암호문·공개키·래핑된 개인키)를 토큰 스코프로 반환.
 * 개인키는 보관 비밀번호로 래핑돼 있어 그 자체로는 무의미하다(§2.2).
 */
export type RewrapContext =
  | {
      applicable: true;
      frontId: string;
      wrappedDek: string;
      keyMaterial: {
        wrappedPrivateKey: string;
        kdfSalt: string;
        kdfParams: unknown;
        wrapIv: string;
      };
      tenantPublicKey: unknown;
    }
  | { applicable: false; reason?: string };

async function engagementByToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("expert_engagements")
    .select("id, expert_id, tenant_id, project_id, status")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();
  return data;
}

export async function getRewrapContext(token: string): Promise<RewrapContext> {
  if (!hasSupabaseEnv()) return { applicable: false };
  const eng = await engagementByToken(token);
  if (!eng || eng.status !== "accepted") return { applicable: false };

  const admin = createAdminClient();
  const [{ data: keyRow }, { data: front }, { data: tenantKey }, { data: grant }] =
    await Promise.all([
      admin
        .from("expert_rrn_keys")
        .select("wrapped_private_key, kdf_salt, kdf_params, wrap_iv")
        .eq("expert_id", eng.expert_id)
        .maybeSingle(),
      admin
        .from("rrn_fragments_front")
        .select("id, wrapped_dek")
        .eq("expert_id", eng.expert_id)
        .is("purged_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("tenant_rrn_keys")
        .select("public_key_jwk")
        .eq("tenant_id", eng.tenant_id)
        .maybeSingle(),
      admin
        .from("tax_project_grants")
        .select("id")
        .eq("engagement_id", eng.id)
        .not("wrapped_dek_for_tenant", "is", null)
        .maybeSingle(),
    ]);

  if (grant) return { applicable: false, reason: "already_done" };
  if (!keyRow || !front) return { applicable: false, reason: "no_rrn" };
  if (!tenantKey?.public_key_jwk) return { applicable: false, reason: "tenant_no_key" };

  return {
    applicable: true,
    frontId: front.id,
    wrappedDek: front.wrapped_dek,
    keyMaterial: {
      wrappedPrivateKey: keyRow.wrapped_private_key,
      kdfSalt: keyRow.kdf_salt,
      kdfParams: keyRow.kdf_params,
      wrapIv: keyRow.wrap_iv,
    },
    tenantPublicKey: tenantKey.public_key_jwk,
  };
}

export type RewrapSubmitResult = { ok: true } | { ok: false; error: string };

/** 재래핑 결과(테넌트 키로 래핑된 DEK) 저장 — tax_project_grants. */
export async function submitRewrap(
  token: string,
  input: { frontId: string; newWrappedDek: string }
): Promise<RewrapSubmitResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const eng = await engagementByToken(token);
  if (!eng || eng.status !== "accepted") {
    return { ok: false, error: "유효한 승인 건이 아닙니다." };
  }
  if (!input.newWrappedDek) return { ok: false, error: "재래핑 결과가 비어 있습니다." };

  const admin = createAdminClient();

  // 프래그먼트 소유 검증(전문가 본인 것인지)
  const { data: front } = await admin
    .from("rrn_fragments_front")
    .select("id, expert_id")
    .eq("id", input.frontId)
    .maybeSingle();
  if (!front || front.expert_id !== eng.expert_id) {
    return { ok: false, error: "대상 주민번호 레코드를 확인할 수 없습니다." };
  }

  // 멱등: 이미 있으면 성공 처리
  const { data: existing } = await admin
    .from("tax_project_grants")
    .select("id")
    .eq("engagement_id", eng.id)
    .not("wrapped_dek_for_tenant", "is", null)
    .maybeSingle();
  if (existing) return { ok: true };

  const { error } = await admin.from("tax_project_grants").insert({
    expert_id: eng.expert_id,
    tenant_id: eng.tenant_id,
    project_id: eng.project_id,
    engagement_id: eng.id,
    front_id: input.frontId,
    wrapped_dek_for_tenant: input.newWrappedDek,
    wrap_alg: "RSA-OAEP-256",
    status: "active",
  });
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  return { ok: true };
}
