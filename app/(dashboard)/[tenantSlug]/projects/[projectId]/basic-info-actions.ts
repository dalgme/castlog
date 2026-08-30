"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { explainActionError } from "@/lib/ux/action-errors";
import {
  gradeFromUser,
  practiceFromUser,
  roleFromUser,
  tenantIdFromUser,
} from "@/lib/auth/tenant";
import { canViewAllProjects, isUserGrade } from "@/lib/auth/grades";
import { recordActionDenial } from "@/lib/monitoring/action-denials";
import {
  projectCreateSchema,
  type ProjectCreateInput,
} from "@/lib/operations/schemas";

/**
 * 프로젝트 기본정보 수정·삭제 (기획 확정 2026-08-30).
 * 두 작업 모두 대표·이사(전사 권한자) 전용 — 담당 배정은 계단으로 위임되지만
 * 기초정보 변경과 삭제는 회사 단위 결정이다.
 */

type BasicResult = { ok: true } | { ok: false; error: string };

async function requireExecutive(): Promise<
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  const grade = gradeFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!isUserGrade(grade) || !canViewAllProjects(grade)) {
    const message =
      "프로젝트 기본정보 수정·삭제는 대표·이사만 할 수 있습니다 (권한 규칙).";
    await recordActionDenial({ kind: "exec:projectBasicInfo", message, user });
    return { ok: false, error: message };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

/** 기본정보 수정 — 명·발주처·연도·코드·기간·예산·설명 */
export async function updateProjectBasicInfo(
  projectId: string,
  input: ProjectCreateInput
): Promise<BasicResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireExecutive();
  if (!gate.ok) return gate;

  const parsed = projectCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const data = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 이름·코드 중복 가드 — 자기 자신은 제외 (생성 가드와 같은 규칙)
  const admin = createAdminClient();
  const practice = practiceFromUser(user);
  const [{ data: sameName }, { data: sameCode }] = await Promise.all([
    admin
      .from("projects")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .eq("is_practice", practice)
      .eq("name", data.name)
      .eq("business_year", parseInt(data.businessYear, 10))
      .neq("id", projectId)
      .limit(1),
    data.code
      ? admin
          .from("projects")
          .select("id")
          .eq("tenant_id", gate.tenantId)
          .eq("is_practice", practice)
          .eq("code", data.code)
          .neq("id", projectId)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  if ((sameName ?? []).length > 0) {
    return {
      ok: false,
      error: `같은 이름의 프로젝트가 ${data.businessYear}년에 이미 있습니다 (중복 방지 규칙). 이름을 바꿔 주세요.`,
    };
  }
  if ((sameCode ?? []).length > 0) {
    return {
      ok: false,
      error: `같은 코드(${data.code})의 프로젝트가 이미 있습니다 (중복 방지 규칙). 다른 코드를 사용해 주세요.`,
    };
  }

  const { data: before } = await supabase
    .from("projects")
    .select("name, business_year, client_name, code, starts_on, ends_on, budget_amount")
    .eq("id", projectId)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("projects")
    .update({
      name: data.name,
      business_year: parseInt(data.businessYear, 10),
      client_name: data.clientName || null,
      code: data.code || null,
      starts_on: data.startsOn || null,
      ends_on: data.endsOn || null,
      budget_amount: data.budgetAmount ? parseInt(data.budgetAmount, 10) : null,
      description: data.description || null,
    })
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "기본정보를 저장하지 못했습니다."),
    };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "프로젝트를 찾을 수 없거나 수정 권한이 없습니다." };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: "project.update_basic",
    resource_type: "project",
    resource_id: projectId,
    before_data: before ?? null,
    after_data: { name: data.name, code: data.code || null },
  });

  revalidatePath("/[tenantSlug]/projects", "page");
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/**
 * 프로젝트 삭제 — **실적이 없는 빈 프로젝트만** (중복 생성 정리용).
 * 세션·섭외·계획 품의가 하나라도 있으면 삭제 대신 상태 전환을 안내한다
 * (§14-4 — 기록이 있는 것은 지우지 않는다).
 */
export async function deleteEmptyProject(projectId: string): Promise<BasicResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireExecutive();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, tenant_id, name, code, business_year")
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  }

  // 실적 존재 검사 — 하나라도 있으면 삭제 불가
  const [{ count: slots }, { count: engagements }, { count: plans }] =
    await Promise.all([
      admin
        .from("engagement_slots")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      admin
        .from("expert_engagements")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      admin
        .from("engagement_plans")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
    ]);
  if ((slots ?? 0) > 0 || (engagements ?? 0) > 0 || (plans ?? 0) > 0) {
    return {
      ok: false,
      error:
        "세션·섭외·품의 기록이 있는 프로젝트는 삭제할 수 없습니다 (기록 보존 규칙). 잘못 만든 중복 건이라면 기록이 없는 쪽을 삭제하고, 이 프로젝트는 상태를 '취소'로 바꿔 보관하세요.",
    };
  }

  // 빈 프로젝트 확정 — 스텝·배정은 FK cascade로 함께 정리된다.
  // 감사 기록을 먼저 남긴다(삭제 후에는 대상이 없다).
  await admin.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: "project.delete_empty",
    resource_type: "project",
    resource_id: projectId,
    before_data: {
      name: project.name,
      code: project.code,
      business_year: project.business_year,
    },
  });

  const { error } = await admin
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    return {
      ok: false,
      error:
        "삭제하지 못했습니다 (연결된 기록이 남아 있을 수 있음). 새로고침 후 다시 시도하거나 상태 전환으로 보관하세요.",
    };
  }

  revalidatePath("/[tenantSlug]/projects", "page");
  return { ok: true };
}
