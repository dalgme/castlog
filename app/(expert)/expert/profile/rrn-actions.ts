"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hasStoreBEnv, createStoreBClient } from "@/lib/supabase/rrn-store-b";

export type RrnCollectionTenant = {
  tenantId: string;
  tenantName: string;
  publicKeyJwk: unknown;
};

export type RrnCollectionContext = {
  storeReady: boolean; // 저장소 B 연결(env) 설정 여부
  alreadyOnFile: boolean; // 이미 등록된 주민번호가 있는지
  tenants: RrnCollectionTenant[]; // 열람 키가 설정된, 내가 연결된 기업
};

async function currentExpertId(): Promise<string | null> {
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
  return expert?.id ?? null;
}

/**
 * 수집 화면 컨텍스트 — 내가 연결(active)된 기업 중 "열람 키(공개키)"가 설정된 곳만
 * 대상. 공개키는 비밀이 아니므로 클라이언트 암호화를 위해 반환한다.
 */
export async function getRrnCollectionContext(): Promise<RrnCollectionContext> {
  const empty: RrnCollectionContext = {
    storeReady: hasStoreBEnv(),
    alreadyOnFile: false,
    tenants: [],
  };
  if (!hasSupabaseEnv()) return empty;
  const expertId = await currentExpertId();
  if (!expertId) return empty;

  const admin = createAdminClient();

  const [{ data: links }, { data: onFile }] = await Promise.all([
    admin
      .from("expert_tenant_links")
      .select("tenant_id, tenants (name)")
      .eq("expert_id", expertId)
      .eq("status", "active"),
    admin
      .from("rrn_fragments_front")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expertId)
      .is("purged_at", null),
  ]);

  const tenantIds = (links ?? []).map((l) => l.tenant_id);
  let tenants: RrnCollectionTenant[] = [];
  if (tenantIds.length > 0) {
    const { data: keys } = await admin
      .from("tenant_rrn_keys")
      .select("tenant_id, public_key_jwk")
      .in("tenant_id", tenantIds);
    const keyByTenant = new Map(
      (keys ?? []).map((k) => [k.tenant_id, k.public_key_jwk])
    );
    tenants = (links ?? [])
      .filter((l) => keyByTenant.has(l.tenant_id))
      .map((l) => ({
        tenantId: l.tenant_id,
        tenantName: l.tenants?.name ?? "(기업)",
        publicKeyJwk: keyByTenant.get(l.tenant_id),
      }));
  }

  return {
    storeReady: hasStoreBEnv(),
    alreadyOnFile: ((onFile as unknown as { count?: number })?.count ?? 0) > 0,
    tenants,
  };
}

export type SubmitRrnResult = { ok: true } | { ok: false; error: string };

/**
 * 봉투 암호문(클라이언트에서 생성) 저장 — 앞조각·wrapped_dek은 메인 DB,
 * 뒷조각은 저장소 B(물리 분리). 평문 주민번호는 서버로 전송되지 않는다.
 */
export async function submitRrnEnvelope(input: {
  tenantId: string;
  frontCiphertext: string;
  backCiphertext: string;
  wrappedDek: string;
}): Promise<SubmitRrnResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  if (!hasStoreBEnv()) {
    return {
      ok: false,
      error: "저장소 연결 설정이 완료되지 않았습니다. 관리자에게 문의하세요.",
    };
  }
  if (
    !input.tenantId ||
    !input.frontCiphertext ||
    !input.backCiphertext ||
    !input.wrappedDek
  ) {
    return { ok: false, error: "입력이 올바르지 않습니다." };
  }

  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  const admin = createAdminClient();

  // 연결된 기업 + 열람 키 존재 확인
  const [{ data: link }, { data: key }] = await Promise.all([
    admin
      .from("expert_tenant_links")
      .select("id")
      .eq("expert_id", expertId)
      .eq("tenant_id", input.tenantId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("tenant_rrn_keys")
      .select("tenant_id")
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
  ]);
  if (!link) return { ok: false, error: "연결된 기업이 아닙니다." };
  if (!key) return { ok: false, error: "기업의 열람 키가 설정되지 않았습니다." };

  // 앞조각 + wrapped_dek → 메인 DB
  const { data: front, error: frontErr } = await admin
    .from("rrn_fragments_front")
    .insert({
      expert_id: expertId,
      tenant_id: input.tenantId,
      front_ciphertext: input.frontCiphertext,
      wrapped_dek: input.wrappedDek,
    })
    .select("id")
    .single();
  if (frontErr || !front) {
    return { ok: false, error: "저장에 실패했습니다(앞조각)." };
  }

  // 뒷조각 → 저장소 B (물리 분리)
  try {
    const storeB = createStoreBClient();
    const { error: backErr } = await storeB.from("rrn_fragments_back").insert({
      front_id: front.id,
      back_ciphertext: input.backCiphertext,
    });
    if (backErr) throw backErr;
  } catch {
    // 롤백: 뒷조각 저장 실패 시 앞조각 제거(한쪽만 남지 않도록)
    await admin.from("rrn_fragments_front").delete().eq("id", front.id);
    return { ok: false, error: "저장에 실패했습니다(뒷조각)." };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}
