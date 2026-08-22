"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hasStoreBEnv, createStoreBClient } from "@/lib/supabase/rrn-store-b";

export type RrnCollectionContext = {
  storeReady: boolean; // 저장소 B 연결(env) 설정 여부
  hasKey: boolean; // 전문가 본인 키페어(보관 비밀번호) 설정 여부
  alreadyOnFile: boolean; // 이미 등록된 주민번호가 있는지
  expertPublicKey: unknown | null; // 전문가 봉투 암호용 공개키(비밀 아님)
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
 * **전문가 본인 키페어**로 봉투 암호화한다(재래핑 설계 §2.1). 개인키는 전문가
 * 보관 비밀번호(passphrase)로 래핑되어 플랫폼은 풀 수단이 없다(마스터키 없음, §11-4).
 * 공개키는 비밀이 아니므로 그대로 반환한다.
 */
export async function getRrnCollectionContext(): Promise<RrnCollectionContext> {
  const empty: RrnCollectionContext = {
    storeReady: hasStoreBEnv(),
    hasKey: false,
    alreadyOnFile: false,
    expertPublicKey: null,
  };
  if (!hasSupabaseEnv()) return empty;
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return empty;

  // 본인 키·본인 프래그먼트만 RLS로 조회(관리자 클라이언트 불필요).
  const [{ data: keyRow }, onFileRes] = await Promise.all([
    supabase
      .from("expert_rrn_keys")
      .select("public_key_jwk")
      .eq("expert_id", expertId)
      .maybeSingle(),
    supabase
      .from("rrn_fragments_front")
      .select("id", { count: "exact", head: true })
      .eq("expert_id", expertId)
      .is("purged_at", null),
  ]);

  return {
    storeReady: hasStoreBEnv(),
    hasKey: Boolean(keyRow?.public_key_jwk),
    alreadyOnFile: (onFileRes.count ?? 0) > 0,
    expertPublicKey: keyRow?.public_key_jwk ?? null,
  };
}

export type SetupKeyResult = { ok: true; publicKey: unknown } | { ok: false; error: string };

/**
 * 전문가 RRN 키페어 최초 등록 — 브라우저에서 생성한 키 자료를 저장한다.
 * 개인키는 보관 비밀번호로 래핑된 암호문만 저장(비밀번호는 서버로 오지 않음).
 * 이미 키가 있으면 그대로 반환(교체는 기존 봉투 무효화라 별도 재설정 절차로만).
 */
export async function setupExpertRrnKey(material: {
  publicKeyJwk: unknown;
  wrappedPrivateKey: string;
  kdfSalt: string;
  kdfParams: unknown;
  wrapIv: string;
  alg: string;
}): Promise<SetupKeyResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const expertId = await currentExpertId();
  if (!expertId) return { ok: false, error: "로그인이 필요합니다." };

  const { data: existing } = await supabase
    .from("expert_rrn_keys")
    .select("public_key_jwk")
    .eq("expert_id", expertId)
    .maybeSingle();
  if (existing?.public_key_jwk) {
    return { ok: true, publicKey: existing.public_key_jwk };
  }

  const { error } = await supabase.from("expert_rrn_keys").insert({
    expert_id: expertId,
    public_key_jwk: material.publicKeyJwk as never,
    wrapped_private_key: material.wrappedPrivateKey,
    kdf_salt: material.kdfSalt,
    kdf_params: material.kdfParams as never,
    wrap_iv: material.wrapIv,
    alg: material.alg,
  });
  if (error) return { ok: false, error: "보관 키 등록에 실패했습니다." };

  revalidatePath("/expert/profile");
  return { ok: true, publicKey: material.publicKeyJwk };
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
  } catch (err) {
    await admin.from("rrn_fragments_front").delete().eq("id", front.id);
    // 원인을 서버 로그에 남긴다 — 오류 메시지에는 암호문·주민번호가 없다.
    // 저장소 B(별도 프로젝트)는 무료 플랜 자동 일시정지·키 회전 등 운영
    // 사유로 끊길 수 있어, 삼키면 "저장 실패"라는 신고로만 돌아온다 (§12-9).
    const message = err instanceof Error ? err.message : String(err);
    console.error("rrn store B insert failed:", message.slice(0, 300));
    const unreachable = /fetch failed|network|ENOTFOUND|ECONN|timeout/i.test(message);
    return {
      ok: false,
      error: unreachable
        ? "저장에 실패했습니다(뒷조각) — 보안 저장소 연결이 끊겨 있습니다. 캐스트로그 운영에 알려 주세요 (저장소 일시정지 가능성)."
        : `저장에 실패했습니다(뒷조각). 캐스트로그에 알려 주세요. (${message.slice(0, 100)})`,
    };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}
