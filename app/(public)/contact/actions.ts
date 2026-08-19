"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { inquirySchema, type InquiryInput } from "@/lib/inquiries/schemas";
import { LEGAL_VERSION } from "@/lib/legal/documents";

export type InquiryResult = { ok: true } | { ok: false; error: string };

/**
 * 도입 문의·무료 체험 신청 접수 (공개 페이지 /contact).
 * 익명 방문자가 제출 → platform_inquiries INSERT (RLS: anon insert 허용).
 * 결제·회원가입 없음. 플랫폼관리자가 후속 연락한다.
 */
export async function submitInquiry(
  input: InquiryInput
): Promise<InquiryResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error: "서버 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const parsed = inquirySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  const { error } = await supabase.from("platform_inquiries").insert({
    inquiry_type: d.inquiryType,
    company_name: d.companyName,
    contact_name: d.contactName,
    email: d.email,
    phone: d.phone ? d.phone : null,
    message: d.message ? d.message : null,
    source: d.source ? d.source : null,
    // 동의 시각과 동의 시점의 문서 버전을 함께 남긴다 — 버전 없이 남기면
    // 나중에 "무엇에 동의했는지"를 재구성할 수 없다.
    privacy_consent_at: new Date().toISOString(),
    marketing_consent_at: d.marketingConsent ? new Date().toISOString() : null,
    terms_version: LEGAL_VERSION,
  });

  if (error) {
    return {
      ok: false,
      error: "접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return { ok: true };
}
