"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import { encryptSecret, hasSecretsKey } from "@/lib/crypto/secrets";
import {
  expertProfileSchema,
  type ExpertProfileInput,
  bankAccountSchema,
  type BankAccountInput,
} from "@/lib/experts/schemas";
import { taxTypeSchema, type TaxTypeInput } from "@/lib/payments/schemas";

export type UpdateProfileError = { error: string };

/** 전문가 프로필 수정 — RLS(experts_update_self)가 본인 행만 허용한다. */
export async function updateExpertProfile(
  input: ExpertProfileInput
): Promise<UpdateProfileError> {
  if (!hasSupabaseEnv()) {
    return { error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = expertProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const { data: updated, error } = await supabase
    .from("experts")
    .update({
      name: parsed.data.name,
      email: parsed.data.email || null,
      specialty: parsed.data.specialty || null,
      region: parsed.data.region || null,
      career_years: parsed.data.careerYears
        ? parseInt(parsed.data.careerYears, 10)
        : null,
      bio: parsed.data.bio || null,
      degree_certifications: parsed.data.degreeCertifications || null,
      secondary_phone: parsed.data.secondaryPhone
        ? normalizeKrMobileE164(parsed.data.secondaryPhone)
        : null,
    })
    .eq("auth_user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { error: "프로필 저장에 실패했습니다. 다시 시도해 주세요." };
  }

  redirect("/expert");
}

export type SetTaxTypeResult = { ok: true } | { ok: false; error: string };

/**
 * 계좌(통장) 정보 저장 — 전문가 본인 (RLS expert_bank_accounts_self_*).
 * 계좌번호는 평문 저장 금지: AES-256-GCM으로 암호화하고 표시용 마지막 4자리만 보관.
 * 계좌번호를 비워 저장하면 은행·예금주만 갱신하고 기존 암호화 값은 유지한다.
 */
export async function saveBankAccount(
  input: BankAccountInput
): Promise<SetTaxTypeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = bankAccountSchema.safeParse(input);
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

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) {
    return { ok: false, error: "전문가 프로필이 없습니다." };
  }

  const rawNumber = (parsed.data.accountNumber ?? "").trim();
  const digits = rawNumber.replace(/\D/g, "");

  let accountNumberEnc: string | null;
  let accountLast4: string | null;

  if (digits) {
    if (!hasSecretsKey()) {
      return {
        ok: false,
        error: "계좌 암호화 키가 설정되지 않았습니다. 관리자에게 문의하세요.",
      };
    }
    accountNumberEnc = encryptSecret(rawNumber);
    accountLast4 = digits.slice(-4);
  } else {
    // 계좌번호 미입력 → 기존 암호화 값 보존 (은행·예금주만 갱신)
    const { data: existing } = await supabase
      .from("expert_bank_accounts")
      .select("account_number_enc, account_last4")
      .eq("expert_id", expert.id)
      .maybeSingle();
    accountNumberEnc = existing?.account_number_enc ?? null;
    accountLast4 = existing?.account_last4 ?? null;
  }

  const { error } = await supabase.from("expert_bank_accounts").upsert(
    {
      expert_id: expert.id,
      bank_name: parsed.data.bankName || null,
      account_holder: parsed.data.accountHolder || null,
      account_number_enc: accountNumberEnc,
      account_last4: accountLast4,
    },
    { onConflict: "expert_id" }
  );

  if (error) {
    return { ok: false, error: "계좌 정보 저장에 실패했습니다." };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}

/**
 * 소득유형 설정 (전문가 본인 — 기획 확정: 사업소득/기타소득/사업자)
 * 지급 품의 시점에 스냅샷되므로, 진행 중인 지급 건에는 소급되지 않는다.
 * 주민등록번호는 절대 다루지 않는다 — 지급유형만 (CLAUDE.md 5).
 */
export async function setExpertTaxType(
  input: TaxTypeInput
): Promise<SetTaxTypeResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = taxTypeSchema.safeParse(input);
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

  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!expert) {
    return { ok: false, error: "전문가 프로필이 없습니다." };
  }

  // RLS(expert_tax_profiles_write)가 본인 행만 허용한다
  const { error } = await supabase.from("expert_tax_profiles").upsert(
    {
      expert_id: expert.id,
      payment_type: parsed.data.paymentType,
      business_registration_number:
        parsed.data.paymentType === "business"
          ? parsed.data.businessRegistrationNumber || null
          : null,
    },
    { onConflict: "expert_id" }
  );

  if (error) {
    return { ok: false, error: "소득유형 저장에 실패했습니다." };
  }

  revalidatePath("/expert/profile");
  return { ok: true };
}
