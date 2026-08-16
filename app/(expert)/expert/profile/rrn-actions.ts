"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hasStoreBEnv, createStoreBClient } from "@/lib/supabase/rrn-store-b";

export type RrnCollectionContext = {
  storeReady: boolean; // 저장소 B 연결(env) 설정 여부
  serviceReady: boolean; // 플랫폼 서비스 공개키 존재 여부
  alreadyOnFile: boolean; // 이미 등록된 주민번호가 있는지
  servicePublicKey: unknown | null; // 봉투 암호용 공개키(비밀 아님)
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
 * 수집 화면 컨텍스트 — 주민번호는 기업과 무관한 전문가 소유 데이터다.
 * 플랫폼 복호화 서비스의 공개키로 봉투 암호화하며, 어떤 기업과도 무관하게 미리
 * 등록할 수 있다(설계문서 §4·§5). 공개키는 비밀이 아니므로 그대로 반환한다.
 */
export async function getRrnCollectionContext(): Promise<RrnCollectionContext> {
  const empty: RrnCollectionContext = {
    storeReady: hasStoreBEnv(),
    serviceReady: false,
    alreadyOnFile: false,
    servicePublicKey: null,
  };
  if (!hasSupabaseEnv()) return empty;
  const expertId = await currentExpertId();
  if (!expertId) return empty;

  const admin = createAdminClient();
  const [{ data: serviceKey }, onFileRes] = await Promise.all([
    admin.from("rrn_service_keys").select("public_key_jwk").eq("id", 1).maybeSingle(),
    admin
      .from("rrn_fragments_front")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expertId)
      .is("purged_at", null),
  ]);

  return {
    storeReady: hasStoreBEnv(),
    serviceReady: Boolean(serviceKey?.public_key_jwk),
    alreadyOnFile: (onFileRes.count ?? 0) > 0,
    servicePublicKey: serviceKey?.public_key_jwk ?? null,
  };
}

export type SubmitRrnResult = { ok: true } | { ok: false; error: string };

/**
 * 봉투 암호문(클라이언트에서 서비스 공개키로 생성) 저장 — 앞조각·wrapped_dek은
 * 메인 DB, 뒷조각은 저장소 B(물리 분리). 기업과 무관한 전문가 소유 레코드로 저장한다.
 * 평문 주민번호는 서버로 전송되지 않는다.
 */
export async function submitRrnEnvelope(input: {
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
  if (!input.frontCiphertext || !input.backCiphertext || !input.wrappedDek) {
    return { ok: false, error: "입력이 올바르지 않습니다." };
  }

  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  const admin = createAdminClient();

  // 앞조각 + wrapped_dek → 메인 DB (기업 무관: tenant_id null)
  const { data: front, error: frontErr } = await admin
    .from("rrn_fragments_front")
    .insert({
      expert_id: expertId,
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
    await admin.from("rrn_fragments_front").delete().eq("id", front.id);
    return { ok: false, error: "저장에 실패했습니다(뒷조각)." };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}
