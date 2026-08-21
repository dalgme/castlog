"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { explainActionError } from "@/lib/ux/action-errors";
import { generateTempPassword } from "@/lib/admin/passwords";
import {
  adminGrantSchema,
  positionCreateSchema,
  staffCreateSchema,
  staffGradeSchema,
  staffProfileSchema,
  type AdminGrantInput,
  type PositionCreateInput,
  type StaffCreateInput,
  type StaffGradeInput,
  type StaffProfileInput,
} from "@/lib/admin/schemas";
import { roleFromGrade } from "@/lib/auth/grades";
import {
  ADMIN_SCOPE_LABELS,
  requireAdminScope,
  requireCeo,
  type AdminScopeSession,
} from "@/lib/auth/admin-scopes";

/**
 * 직원 계정·권한 관리 세션.
 * CEO는 항상 통과, 그 외는 'staff' 스코프를 위임받았을 때만 통과한다.
 */
async function requireStaffAdmin(): Promise<AdminScopeSession> {
  return requireAdminScope("staff");
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

  const session = await requireStaffAdmin();
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
      grade: data.grade,
      role: roleFromGrade(data.grade), // grade에서 파생 — DB 트리거와 동일 규칙
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
    grade: data.grade, // role은 DB 트리거가 파생시킨다
    phone: data.phone || null,
    department: data.department || null,
    position_id: data.positionId || null,
    joined_via: "admin_created",
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "직원 프로필 생성에 실패했습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.create",
    resource_type: "user",
    resource_id: created.user.id,
    after_data: { grade: data.grade },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
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

  const session = await requireStaffAdmin();
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
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: active ? "user.activate" : "user.deactivate",
    resource_type: "user",
    resource_id: targetUserId,
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/** 직급 추가 — 기업별 관리, 하드코딩 금지 (실행계획서 단계 8) */
export async function createPosition(
  input: PositionCreateInput
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireStaffAdmin();
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
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/** 직급 삭제 — 사용 중이면 소속 직원의 직급이 해제된다 (FK on delete set null) */
export async function deletePosition(
  positionId: string
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireStaffAdmin();
  if (!session.ok) return session;

  const supabase = createClient();
  const { error } = await supabase.from("positions").delete().eq("id", positionId);
  if (error) {
    return { ok: false, error: "직급 삭제에 실패했습니다." };
  }

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/**
 * 권한단계 변경 (6단계). users.role은 DB 트리거가 파생시키므로 직접 쓰지 않는다.
 * JWT app_metadata도 함께 갱신해야 다음 토큰 갱신부터 RLS가 새 등급을 본다.
 */
export async function setStaffGrade(
  input: StaffGradeInput
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireStaffAdmin();
  if (!session.ok) return session;

  const parsed = staffGradeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const { userId: targetUserId, grade } = parsed.data;

  // 대표 지정·해제는 CEO만 — 위임받은 관리자가 스스로 대표가 될 수 없다
  if (!session.isCeo && grade === "ceo") {
    return { ok: false, error: "대표 권한 부여는 대표만 할 수 있습니다." };
  }
  if (targetUserId === session.userId) {
    return { ok: false, error: "본인의 권한단계는 변경할 수 없습니다." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, tenant_id, grade")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId) {
    return { ok: false, error: "대상 직원을 찾을 수 없습니다." };
  }
  if (!session.isCeo && target.grade === "ceo") {
    return { ok: false, error: "대표 계정의 권한단계는 대표만 변경할 수 있습니다." };
  }
  if (target.grade === grade) return { ok: true };

  const { error } = await admin
    .from("users")
    .update({ grade })
    .eq("id", targetUserId);
  if (error) return { ok: false, error: "권한단계 변경에 실패했습니다." };

  const { data: authUser } = await admin.auth.admin.getUserById(targetUserId);
  await admin.auth.admin.updateUserById(targetUserId, {
    app_metadata: {
      ...(authUser?.user?.app_metadata ?? {}),
      grade,
      role: roleFromGrade(grade),
    },
  });

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.grade_change",
    resource_type: "user",
    resource_id: targetUserId,
    before_data: { grade: target.grade },
    after_data: { grade },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/**
 * 관리권한 위임 부여 (CEO 전용).
 * 세무(주민등록번호) 조회 권한은 위임 대상이 아니다 — tax_access_grants는 별도 화면에서
 * 대표만 지정한다 (CLAUDE.md §5).
 */
export async function grantAdminScopes(
  input: AdminGrantInput
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireCeo();
  if (!session.ok) return session;

  const parsed = adminGrantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const { userId: targetUserId, scopes, note } = parsed.data;

  const supabase = createClient();
  const { data: target } = await supabase
    .from("users")
    .select("id, name, grade, is_active")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target) return { ok: false, error: "대상 직원을 찾을 수 없습니다." };
  if (!target.is_active) {
    return { ok: false, error: "비활성 계정에는 위임할 수 없습니다." };
  }

  // 이미 활성 위임이 있는 스코프는 건너뛴다 (부분 유니크 인덱스 충돌 방지)
  const { data: existing } = await supabase
    .from("tenant_admin_grants")
    .select("scope")
    .eq("user_id", targetUserId)
    .is("revoked_at", null);
  const held = new Set((existing ?? []).map((row) => row.scope));
  const toGrant = scopes.filter((scope) => !held.has(scope));
  if (toGrant.length === 0) return { ok: true };

  // 스코프별로 따로 넣는다. 한 배치로 넣으면 하나가 DB 제약(예: 마이그레이션
  // 미적용으로 신 스코프가 check에 걸림)에 걸릴 때 나머지 정상 스코프까지
  // 통째로 실패한다 — 실제로 그렇게 죽는 경로가 검수에서 확인됐다.
  const failed: string[] = [];
  let lastError: string | undefined;
  for (const scope of toGrant) {
    const { error } = await supabase.from("tenant_admin_grants").insert({
      tenant_id: session.tenantId,
      user_id: targetUserId,
      scope,
      note: note?.trim() || null,
      granted_by: session.userId,
    });
    if (error) {
      failed.push(ADMIN_SCOPE_LABELS[scope]);
      lastError = error.message;
    }
  }
  if (failed.length > 0) {
    return {
      ok: false,
      error: await explainActionError(
        lastError,
        `일부 위임에 실패했습니다 (${failed.join(", ")}).`
      ),
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: "org_admin",
    action: "admin_scope.grant",
    resource_type: "user",
    resource_id: targetUserId,
    after_data: {
      scopes: toGrant,
      labels: toGrant.map((scope) => ADMIN_SCOPE_LABELS[scope]),
    },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/** 관리권한 위임 회수 (CEO 전용) — 삭제하지 않고 revoked_at 기록 (§14-4). */
export async function revokeAdminGrant(
  grantId: string
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireCeo();
  if (!session.ok) return session;

  const supabase = createClient();
  const { data: grant } = await supabase
    .from("tenant_admin_grants")
    .select("id, user_id, scope, revoked_at")
    .eq("id", grantId)
    .maybeSingle();
  if (!grant) return { ok: false, error: "위임 내역을 찾을 수 없습니다." };
  if (grant.revoked_at) return { ok: true };

  const { error } = await supabase
    .from("tenant_admin_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: session.userId })
    .eq("id", grantId);
  if (error) return { ok: false, error: "회수에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: "org_admin",
    action: "admin_scope.revoke",
    resource_type: "user",
    resource_id: grant.user_id,
    before_data: { scope: grant.scope },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

/**
 * 직원 정보 수정 — 이름·이메일·연락처·부서·직급.
 *
 * 권한단계(grade)는 여기서 다루지 않는다. 정보 수정과 권한 조정을 한 폼에 섞으면
 * 부서 오타를 고치다가 등급을 잘못 건드린다. 그래서 본인 것도 여기서는 고칠 수
 * 있다 — 이름·부서를 바꾸는 일에 위험이 없기 때문이다.
 *
 * 이메일은 **로그인 아이디**다. 바꾸면 다음 로그인부터 새 주소로 들어와야 하므로
 * auth 계정까지 함께 옮긴다. 한쪽만 바꾸면 로그인은 되는데 화면에는 옛 주소가
 * 남거나, 그 반대가 된다.
 */
export async function updateStaffProfile(
  input: StaffProfileInput
): Promise<StaffActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireStaffAdmin();
  if (!session.ok) return session;

  const parsed = staffProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const admin = createAdminClient();

  // 같은 테넌트 소속인지 검증 (다른 테넌트 계정 조작 차단)
  const { data: target } = await admin
    .from("users")
    .select("id, tenant_id, email")
    .eq("id", data.userId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId) {
    return { ok: false, error: "대상 직원을 찾을 수 없습니다." };
  }

  const nextEmail = data.email.toLowerCase();
  const emailChanged = nextEmail !== target.email.toLowerCase();

  if (emailChanged) {
    // 같은 주소를 쓰는 계정이 이미 있으면 로그인이 겹친다
    const { data: duplicate } = await admin
      .from("users")
      .select("id")
      .eq("email", nextEmail)
      .neq("id", data.userId)
      .maybeSingle();
    if (duplicate) {
      return { ok: false, error: "이미 사용 중인 이메일입니다." };
    }

    const { error: authError } = await admin.auth.admin.updateUserById(
      data.userId,
      { email: nextEmail, email_confirm: true }
    );
    if (authError) {
      return {
        ok: false,
        error: "로그인 계정의 이메일 변경에 실패했습니다. 주소를 확인하세요.",
      };
    }
  }

  const { error } = await admin
    .from("users")
    .update({
      name: data.name,
      email: nextEmail,
      phone: data.phone ? data.phone : null,
      department: data.department ? data.department : null,
      position_id: data.positionId ? data.positionId : null,
    })
    .eq("id", data.userId);
  if (error) {
    return { ok: false, error: "정보 수정에 실패했습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.update_profile",
    resource_type: "user",
    resource_id: data.userId,
    after_data: emailChanged ? { email_changed: true } : null,
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}

export type DeleteStaffResult =
  | { ok: true }
  | { ok: false; error: string; blockedBy?: string[] };

/**
 * 직원 계정 삭제.
 *
 * **업무 이력이 남아 있으면 지우지 않는다.** 결재·배정·감사로그에 이름이 걸린
 * 계정을 지우면 "누가 승인했는지 모르는 결재건"이 생긴다. 그건 기록을 없애는
 * 것이지 계정을 정리하는 게 아니다. 그런 계정은 **비활성화**가 정답이고,
 * 화면에도 그렇게 안내한다 (CLAUDE.md §14-4: 삭제보다 비활성화).
 *
 * 그래서 실제로 지워지는 것은 '잘못 만든 계정'뿐이다 — 오타로 만들었거나
 * 입사가 취소된 사람. 그건 남겨 둘 이유가 없다.
 */
export async function deleteStaffUser(
  targetUserId: string
): Promise<DeleteStaffResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requireStaffAdmin();
  if (!session.ok) return { ok: false, error: session.error };

  if (targetUserId === session.userId) {
    return { ok: false, error: "본인 계정은 삭제할 수 없습니다." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, tenant_id, name, grade")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target || target.tenant_id !== session.tenantId) {
    return { ok: false, error: "대상 직원을 찾을 수 없습니다." };
  }
  if (target.grade === "ceo") {
    return {
      ok: false,
      error:
        "대표 계정은 삭제할 수 없습니다. 대표를 바꾸려면 다른 직원을 대표로 지정한 뒤 이 계정을 비활성화하세요.",
    };
  }

  // 업무 이력 확인 — 하나라도 있으면 삭제 대신 비활성화를 안내한다
  const [assignments, approvals, approvalSteps, auditLogs, projects] =
    await Promise.all([
      admin
        .from("project_assignments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", targetUserId),
      admin
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("requester_user_id", targetUserId),
      admin
        .from("approval_steps")
        .select("id", { count: "exact", head: true })
        .eq("approver_user_id", targetUserId),
      admin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("actor_auth_user_id", targetUserId),
      admin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("created_by", targetUserId),
    ]);

  const blockedBy: string[] = [];
  if ((assignments.count ?? 0) > 0) blockedBy.push("프로젝트 담당자 배정");
  if ((approvals.count ?? 0) > 0) blockedBy.push("본인이 올린 결재건");
  if ((approvalSteps.count ?? 0) > 0) blockedBy.push("결재선에 지정된 이력");
  if ((auditLogs.count ?? 0) > 0) blockedBy.push("시스템 사용 기록(감사로그)");
  if ((projects.count ?? 0) > 0) blockedBy.push("본인이 개설한 프로젝트");

  if (blockedBy.length > 0) {
    return {
      ok: false,
      error:
        "업무 이력이 남아 있어 삭제할 수 없습니다. 이력을 지우면 ‘누가 했는지 모르는 기록’이 생깁니다. 대신 비활성화하면 로그인은 막히고 기록은 그대로 남습니다.",
      blockedBy,
    };
  }

  // 위임받은 관리 권한이 있으면 함께 회수 (계정이 사라지면 회수할 방법이 없다)
  await admin
    .from("tenant_admin_grants")
    .delete()
    .eq("user_id", targetUserId)
    .eq("tenant_id", session.tenantId);

  const { error } = await admin.from("users").delete().eq("id", targetUserId);
  if (error) {
    return {
      ok: false,
      error: "삭제에 실패했습니다. 남아 있는 기록이 있는지 확인하세요.",
    };
  }

  // 로그인 계정도 함께 지운다 — 남겨 두면 로그인은 되는데 소속이 없는 상태가 된다
  await admin.auth.admin.deleteUser(targetUserId);

  await admin.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.isCeo ? "org_admin" : "manager",
    action: "user.delete",
    resource_type: "user",
    resource_id: targetUserId,
    before_data: { name: target.name, grade: target.grade },
  });

  revalidatePath("/[tenantSlug]/admin/org", "page");
  revalidatePath("/[tenantSlug]/admin/staff", "page");
  return { ok: true };
}
