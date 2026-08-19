"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import { generateTempPassword } from "@/lib/admin/passwords";
import {
  tenantCreateSchema,
  tenantModulesSchema,
  type TenantCreateInput,
  type TenantModulesInput,
} from "@/lib/admin/schemas";

export type CreateTenantResult =
  | { ok: true; tempPassword: string; orgAdminEmail: string }
  | { ok: false; error: string };

/** 현재 세션이 플랫폼관리자인지 확인 (JWT app_metadata 기준) */
async function requirePlatformAdminSession(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}

/**
 * 테넌트 생성 (설계문서 7.1 — 셀프 온보딩 없음, 플랫폼관리자 수동 생성)
 * 모듈 조합 선택(CLAUDE.md 1-2-7) + 첫 기업총괄관리자 계정을 함께 만든다.
 * 임시 비밀번호는 1회만 반환하고 저장하지 않는다.
 *
 * inquiryId를 넘기면(도입 문의 화면에서 생성한 경우) 해당 신청을
 * '테넌트 생성됨'으로 전환한다 — 실패해도 테넌트 생성은 되돌리지 않는다.
 */
export async function createTenant(
  input: TenantCreateInput,
  inquiryId?: string
): Promise<CreateTenantResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  const parsed = tenantCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const admin = createAdminClient();

  // 1) 테넌트 생성 (slug unique — 중복 시 DB 제약이 거른다)
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({
      slug: data.slug,
      name: data.name,
      plan_name: data.planName || null,
      feature_flags: { modules: data.modules },
    })
    .select("id, slug")
    .single();

  if (tenantError || !tenant) {
    if (tenantError?.code === "23505") {
      return { ok: false, error: "이미 사용 중인 슬러그입니다." };
    }
    return { ok: false, error: "테넌트 생성에 실패했습니다." };
  }

  // 2) 기업총괄관리자 계정 생성 — tenant_id·role은 app_metadata에만 (CLAUDE.md 3)
  const tempPassword = generateTempPassword();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: data.orgAdminEmail,
    password: tempPassword,
    email_confirm: true,
    app_metadata: {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      grade: "ceo", // 권한 6단계 — 판정의 원본 (CLAUDE.md 3-1)
      role: "org_admin", // grade에서 파생된 호환값
      must_change_password: true, // 단계 30: 최초 로그인 시 비밀번호 강제 변경
    },
  });

  if (userError || !created.user) {
    // 롤백 — 방금 만든 테넌트 제거
    await admin.from("tenants").delete().eq("id", tenant.id);
    return {
      ok: false,
      error:
        userError?.code === "email_exists"
          ? "이미 등록된 이메일입니다."
          : "총괄관리자 계정 생성에 실패했습니다.",
    };
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    name: data.orgAdminName,
    email: data.orgAdminEmail,
    // grade만 지정한다 — role은 DB 트리거(sync_role_from_grade)가 파생시킨다.
    // role만 넘기면 트리거가 기본 grade('staff') 기준으로 덮어써 대표가 사원이 된다.
    grade: "ceo",
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, error: "총괄관리자 프로필 생성에 실패했습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action: "tenant.create",
    resource_type: "tenant",
    resource_id: tenant.id,
    after_data: { slug: tenant.slug, modules: data.modules },
  });

  // 도입 문의에서 이어진 생성이면 신청 상태를 정리한다.
  if (inquiryId) {
    await admin
      .from("platform_inquiries")
      .update({ status: "converted", handled_by: session.userId })
      .eq("id", inquiryId);
    revalidatePath("/platform-admin/inquiries");
  }

  revalidatePath("/platform-admin");
  return { ok: true, tempPassword, orgAdminEmail: data.orgAdminEmail };
}

export type UpdateModulesResult = { ok: true } | { ok: false; error: string };

/** 테넌트 모듈 조합 변경 — 기존 feature_flags의 다른 키는 보존한다 */
export async function updateTenantModules(
  input: TenantModulesInput
): Promise<UpdateModulesResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  const parsed = tenantModulesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "입력값을 확인하세요." };
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, feature_flags")
    .eq("id", parsed.data.tenantId)
    .maybeSingle();
  if (!tenant) {
    return { ok: false, error: "존재하지 않는 테넌트입니다." };
  }

  const currentFlags =
    tenant.feature_flags &&
    typeof tenant.feature_flags === "object" &&
    !Array.isArray(tenant.feature_flags)
      ? tenant.feature_flags
      : {};

  const { error: updateError } = await admin
    .from("tenants")
    .update({
      feature_flags: { ...currentFlags, modules: parsed.data.modules },
      // 기업 화면의 '새로 켜진 기능' 안내 노출 판정에 쓴다 (CLAUDE.md §1-2-8)
      modules_changed_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (updateError) {
    return { ok: false, error: "모듈 설정 변경에 실패했습니다." };
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action: "tenant.update_modules",
    resource_type: "tenant",
    resource_id: tenant.id,
    before_data: { feature_flags: currentFlags },
    after_data: { modules: parsed.data.modules },
  });

  revalidatePath("/platform-admin");
  return { ok: true };
}

export type TenantStatusResult = { ok: true } | { ok: false; error: string };

/**
 * 테넌트 상태 변경 (활성 ↔ 중지).
 *
 * 중지는 그 회사 전원의 로그인을 막는 조치다 — 되돌릴 수는 있지만 그 사이의
 * 업무는 멈춘다. 그래서 화면에서 2단계 확인을 거치고(§14-3), 여기서는 사유를
 * 함께 받아 감사로그에 남긴다. '누가 언제 왜 껐는지'가 남지 않으면 나중에
 * 아무도 되돌릴 근거를 대지 못한다.
 *
 * 해지(terminated)는 여기서 다루지 않는다 — 데이터 파기·계약 종료가 얽혀
 * 있어 별도 절차가 필요하다.
 */
export async function setTenantStatus(input: {
  tenantId: string;
  status: "active" | "suspended";
  reason?: string;
}): Promise<TenantStatusResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const session = await requirePlatformAdminSession();
  if (!session.ok) return session;

  if (input.status !== "active" && input.status !== "suspended") {
    return { ok: false, error: "상태 값을 확인하세요." };
  }
  if ((input.reason ?? "").length > 500) {
    return { ok: false, error: "사유는 500자 이내로 입력하세요." };
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status")
    .eq("id", input.tenantId)
    .maybeSingle();
  if (!tenant) return { ok: false, error: "존재하지 않는 테넌트입니다." };
  if (tenant.status === "terminated") {
    return { ok: false, error: "해지된 테넌트는 이 화면에서 되돌릴 수 없습니다." };
  }
  if (tenant.status === input.status) return { ok: true };

  const { error } = await admin
    .from("tenants")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", tenant.id);
  if (error) return { ok: false, error: "상태 변경에 실패했습니다." };

  await admin.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_auth_user_id: session.userId,
    actor_role: "platform_admin",
    action:
      input.status === "suspended" ? "tenant.suspend" : "tenant.reactivate",
    resource_type: "tenant",
    resource_id: tenant.id,
    before_data: { status: tenant.status },
    after_data: { status: input.status, reason: input.reason?.trim() || null },
  });

  revalidatePath("/platform-admin");
  return { ok: true };
}
