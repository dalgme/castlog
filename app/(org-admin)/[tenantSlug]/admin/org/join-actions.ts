"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { generateTempPassword } from "@/lib/admin/passwords";
import { requireAdminScope } from "@/lib/auth/admin-scopes";
import { isUserGrade, roleFromGrade } from "@/lib/auth/grades";
import {
  staffJoinApproveSchema,
  type StaffJoinApproveInput,
} from "@/lib/admin/join-schemas";

export type ApproveJoinResult =
  | { ok: true; email: string; tempPassword: string }
  | { ok: false; error: string };

/**
 * 임직원 가입 신청 승인 → 계정 생성.
 *
 * 권한단계는 **승인자가 여기서 정한다.** 신청서에는 등급 항목이 없다.
 * 승인 즉시 계정이 만들어지고 임시 비밀번호가 1회만 표시된다(저장하지 않는다).
 * 신청 시점의 약관 동의는 신청 레코드에 있으므로 계정으로 옮겨 적는다.
 */
export async function approveJoinRequest(
  input: StaffJoinApproveInput
): Promise<ApproveJoinResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  const parsed = staffJoinApproveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const d = parsed.data;
  if (!isUserGrade(d.grade)) {
    return { ok: false, error: "권한단계를 선택하세요." };
  }
  // 대표(ceo) 등급 부여는 대표만 가능 (CLAUDE.md §3-1 위임 금지 대상 3)
  if (d.grade === "ceo" && !session.isCeo) {
    return { ok: false, error: "대표 등급 부여는 대표 계정만 할 수 있습니다." };
  }

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("staff_join_requests")
    .select(
      "id, tenant_id, name, email, phone, department, status, terms_version, terms_agreed_at"
    )
    .eq("id", d.requestId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (!request) return { ok: false, error: "신청을 찾을 수 없습니다." };
  if (request.status !== "pending") {
    return { ok: false, error: "이미 처리된 신청입니다." };
  }

  const tempPassword = generateTempPassword();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: request.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: {
      tenant_id: session.tenantId,
      tenant_slug: session.tenantSlug,
      grade: d.grade,
      role: roleFromGrade(d.grade),
      must_change_password: true,
    },
  });
  if (userError || !created.user) {
    return {
      ok: false,
      error:
        userError?.code === "email_exists"
          ? "이미 등록된 이메일입니다. 신청을 반려해 주세요."
          : "계정 생성에 실패했습니다.",
    };
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    tenant_id: session.tenantId,
    name: request.name,
    email: request.email,
    phone: request.phone,
    grade: d.grade, // role은 DB 트리거가 파생시킨다
    department: request.department,
    position_id: d.positionId || null,
    joined_via: "self_signup",
    terms_version: request.terms_version,
    terms_agreed_at: request.terms_agreed_at,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "직원 프로필 생성에 실패했습니다." };
  }

  await admin
    .from("staff_join_requests")
    .update({
      status: "approved",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      decision_note: d.note?.trim() || null,
      created_user_id: created.user.id,
    })
    .eq("id", request.id);

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "staff_join_request.approve",
    resource_type: "staff_join_requests",
    resource_id: request.id,
    after_data: { grade: d.grade, user_id: created.user.id },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true, email: request.email, tempPassword };
}

export type RejectJoinResult = { ok: true } | { ok: false; error: string };

/** 가입 신청 반려. 계정은 만들어지지 않는다. */
export async function rejectJoinRequest(
  requestId: string,
  note: string
): Promise<RejectJoinResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requireAdminScope("staff");
  if (!session.ok) return session;

  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("staff_join_requests")
    .update({
      status: "rejected",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      decision_note: note.trim() || null,
    })
    .eq("id", requestId)
    .eq("tenant_id", session.tenantId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!updated) return { ok: false, error: "이미 처리된 신청입니다." };

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "staff_join_request.reject",
    resource_type: "staff_join_requests",
    resource_id: requestId,
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}
