import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 주민번호 키 재래핑 — 공용 로직 (E2E 검수 전문가 P1-2·P2-1).
 *
 * 전문가가 섭외를 수락하면 그 프로젝트·그 기업 권한자용으로만 DEK를 다시
 * 봉인해 전달한다(§5 계약시점 키위임). 처리는 전문가 브라우저에서 하고
 * 서버는 자료(래핑된 개인키·암호문·기업 공개키)를 내주고 결과를 저장할 뿐이다.
 *
 * 진입은 두 곳이고 같은 함수를 쓴다:
 *  · 공개 링크(/e) — 수락 직후 같은 화면에서, 응답 후 REWRAP_WINDOW_HOURS 안에만
 *    (토큰이 영구 인증 수단이 되어 제3자가 쓰레기 값을 넣는 경로 차단)
 *  · 전문가 포털 수락서 화면 — 로그인 세션 기반, 기간 제한 없음 (묶음 수락·
 *    화면을 닫은 전문가의 정식 경로)
 */

/** 공개 링크로 재래핑을 허용하는 창 — 수락 응답 시각 기준 */
export const REWRAP_WINDOW_HOURS = 72;

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
  | {
      applicable: false;
      reason?: "already_done" | "no_rrn" | "tenant_no_key" | "window_closed" | "not_accepted";
    };

export type RewrapEngagement = {
  id: string;
  expert_id: string;
  tenant_id: string;
  project_id: string | null;
  status: string;
};

export async function buildRewrapContext(
  eng: RewrapEngagement
): Promise<RewrapContext> {
  if (eng.status !== "accepted") return { applicable: false, reason: "not_accepted" };

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

/**
 * 재래핑 결과 저장 — tax_project_grants. 값 형식(RSA-OAEP 래핑 결과 = base64)
 * 을 검사해 쓰레기 값이 정당한 전달을 막는 일을 줄인다.
 */
export async function saveRewrapResult(
  eng: RewrapEngagement,
  input: { frontId: string; newWrappedDek: string }
): Promise<RewrapSubmitResult> {
  if (eng.status !== "accepted") {
    return { ok: false, error: "유효한 승인 건이 아닙니다." };
  }
  const value = input.newWrappedDek?.trim() ?? "";
  // 2048비트 RSA-OAEP 결과 = 256바이트 → base64 344자. 4096비트면 684자.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length < 300 || value.length > 1200) {
    return { ok: false, error: "재래핑 결과 형식이 올바르지 않습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요." };
  }

  const admin = createAdminClient();
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
    wrapped_dek_for_tenant: value,
    wrap_alg: "RSA-OAEP-256",
    status: "active",
  });
  if (error) return { ok: false, error: "저장에 실패했습니다." };
  return { ok: true };
}

/** 응답 시각이 창 안인가 — 공개 링크 경로 전용 */
export function withinRewrapWindow(respondedAt: string | null): boolean {
  if (!respondedAt) return false;
  const elapsed = Date.now() - new Date(respondedAt).getTime();
  return elapsed >= 0 && elapsed <= REWRAP_WINDOW_HOURS * 60 * 60 * 1000;
}
