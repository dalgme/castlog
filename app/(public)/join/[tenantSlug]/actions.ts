"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { LEGAL_VERSION } from "@/lib/legal/documents";
import {
  staffJoinRequestSchema,
  type StaffJoinRequestInput,
} from "@/lib/admin/join-schemas";

export type JoinRequestResult = { ok: true } | { ok: false; error: string };

/**
 * 임직원 셀프 가입 신청 (비로그인).
 *
 * 계정을 만들지 않는다. 신청서만 남기고 대표(또는 staff 위임자)가 승인할 때
 * 계정이 생성된다 — 승인 없이 계정이 생기면 슬러그만 아는 외부인이 사내 계정을
 * 만들 수 있다.
 *
 * 응답은 **성공/실패를 구분해 알려주지 않는 부분이 있다.** 이미 계정이 있는
 * 이메일인지, 이미 신청했는지를 그대로 알려주면 재직자 명부 확인 수단이 된다.
 */
export async function submitJoinRequest(
  input: StaffJoinRequestInput
): Promise<JoinRequestResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const parsed = staffJoinRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const d = parsed.data;

  // 슬러그 → 테넌트. 비로그인 요청이므로 admin 클라이언트로 확인하되,
  // 존재 여부를 응답으로 흘리지 않는다(테넌트 슬러그 대조 방지).
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, status")
    .eq("slug", d.tenantSlug)
    .maybeSingle();

  if (!tenant || tenant.status !== "active") {
    // 존재하지 않거나 중지된 기업 — 접수한 것처럼 응답하고 아무것도 남기지 않는다.
    return { ok: true };
  }

  const email = d.email.toLowerCase();

  // 이미 계정이 있거나 대기 중 신청이 있으면 조용히 성공 응답만 한다.
  const [{ data: existingUser }, { data: openRequest }] = await Promise.all([
    admin
      .from("users")
      .select("id")
      .eq("tenant_id", tenant.id)
      .ilike("email", email)
      .maybeSingle(),
    admin
      .from("staff_join_requests")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .ilike("email", email)
      .maybeSingle(),
  ]);
  if (existingUser || openRequest) return { ok: true };

  const now = new Date().toISOString();
  const { error } = await admin.from("staff_join_requests").insert({
    tenant_id: tenant.id,
    name: d.name,
    email,
    phone: d.phone,
    department: d.department || null,
    note: d.note || null,
    terms_version: LEGAL_VERSION,
    terms_agreed_at: now,
    privacy_agreed_at: now,
  });
  if (error) {
    return { ok: false, error: "접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true };
}
