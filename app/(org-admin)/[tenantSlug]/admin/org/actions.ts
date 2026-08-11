"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { generateTempPassword } from "@/lib/admin/passwords";
import {
  positionCreateSchema,
  staffCreateSchema,
  type PositionCreateInput,
  type StaffCreateInput,
} from "@/lib/admin/schemas";

type OrgAdminSession =
  | { ok: true; userId: string; tenantId: string; tenantSlug: string }
  | { ok: false; error: string };

/** 기업총괄관리자 세션 확인 — tenant_id는 JWT app_metadata에서만 (CLAUDE.md 3) */
async function requireOrgAdminSession(): Promise<OrgAdminSession> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = tenantIdFromUser(user);
  const tenantSlug = user?.app_metadata?.tenant_slug;
  if (
    !user ||
    !tenantId ||
    roleFromUser(user) !== "org_admin" ||
    typeof tenantSlug !== "string"
  ) {
    return { ok: false, error: "기업총괄관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id, tenantId, tenantSlug };
}

export type CreateStaffResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; error: string };

/**
 * 직원 계정 생성 (설계문서 3.1 — 직원은 총괄관리자가 생성, 셀프 가입 없음)
 * 임시 비밀번호는 1회만 반환·표시하고 저장하지 않는다 (초대 메일은 단계 14).
 */
export async function createStaffUser(
  input: StaffCreateInput
): Promise<CreateStaffResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  const parsed = staffCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: data.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: {
      tenant_id: session.tenantId,
      tenant_slug: session.tenantSlug,
      role: data.role,
      must_change_password: true, // 단계 30: 최초 로그인 시 비밀번호 강제 변경
    },
  });

  if (userError || !created.user) {
    return {
      ok: false,
      error:
        userError?.code === "email_exists"
          ? "이미 등록된 이메일입니다."
          : "계정 생성에 실패했습니다.",
    };
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    tenant_id: session.tenantId,
    name: data.name,
    email: data.email,
    role: data.role,
    department: data.department || null,
    position_id: data.positionId || null,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "직원 프로필 생성에 실패했습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: "org_admin",
    action: "user.create",
    resource_type: "user",
    resource_id: created.user.id,
    after_data: { role: data.role },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true, tempPassword, email: data.email };
}

export type StaffActionResult = { ok: true } | { ok: false; error: string };

/** 직원 활성/비활성 — 비활성 시 로그인 차단(ban), users.is_active 동기화 */
export async function setStaffActive(
  targetUserId: string,
  active: boolean
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  if (targetUserId === session.userId) {
    return { ok: false, error: "본인 계정은 비활성화할 수 없습니다." };
  }

  const admin = createAdminClient();

  // 같은 테넌트 소속인지 검증 (다른 테넌트 계정 조작 차단)
  const { data: target } = await admin
    .from("users")
    .select("id, tenant_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId) {
    return { ok: false, error: "대상 직원을 찾을 수 없습니다." };
  }

  const { error: banError } = await admin.auth.admin.updateUserById(targetUserId, {
    ban_duration: active ? "none" : "876000h", // 약 100년 = 사실상 영구
  });
  if (banError) {
    return { ok: false, error: "계정 상태 변경에 실패했습니다." };
  }

  await admin.from("users").update({ is_active: active }).eq("id", targetUserId);

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: "org_admin",
    action: active ? "user.activate" : "user.deactivate",
    resource_type: "user",
    resource_id: targetUserId,
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 직급 추가 — 기업별 관리, 하드코딩 금지 (실행계획서 단계 8) */
export async function createPosition(
  input: PositionCreateInput
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  const parsed = positionCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  // RLS(positions_write)가 자사 + org_admin을 강제한다
  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from("positions")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("positions").insert({
    tenant_id: session.tenantId,
    name: parsed.data.name,
    sort_order: (maxRow?.sort_order ?? 0) + 1,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "이미 존재하는 직급명입니다."
          : "직급 추가에 실패했습니다.",
    };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}

/** 직급 삭제 — 사용 중이면 소속 직원의 직급이 해제된다 (FK on delete set null) */
export async function deletePosition(
  positionId: string
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireOrgAdminSession();
  if (!session.ok) return session;

  const supabase = createClient();
  const { error } = await supabase.from("positions").delete().eq("id", positionId);
  if (error) {
    return { ok: false, error: "직급 삭제에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  return { ok: true };
}
