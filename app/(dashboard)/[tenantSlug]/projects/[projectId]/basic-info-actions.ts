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
 * 프로젝트 기본정보 수정·삭제·보관 (기획 확정 2026-08-30, 오후 개정).
 * - 수정: 대표·이사 + **그 프로젝트의 PL·PM(겸임 포함)** — "PM급 이상에게
 *   제목·내용·수정 권한을 기본 제공" 확정. DB 컬럼 가드도 같은 축으로 확장
 *   (마이그레이션 20260830000003).
 * - 삭제(빈 프로젝트)·보관(기록 있는 중복 정리): 대표·이사 전용 — 회사 단위 결정.
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

/** 수정 권한: 대표·이사 또는 그 프로젝트의 PL·PM(겸임) — PM급 이상 (기획 2026-08-30) */
async function requireProjectEditor(projectId: string): Promise<
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
  if (isUserGrade(grade) && canViewAllProjects(grade)) {
    return { ok: true, userId: user.id, tenantId, role };
  }
  const { data: mine } = await supabase
    .from("project_assignments")
    .select("assignment_role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mine && ["pl", "pl_pm", "pm"].includes(mine.assignment_role)) {
    return { ok: true, userId: user.id, tenantId, role };
  }
  const message =
    "프로젝트 기본정보 수정은 대표·이사 또는 이 프로젝트의 PL·PM만 할 수 있습니다 (권한 규칙).";
  await recordActionDenial({ kind: "exec:projectBasicInfo", message, user });
  return { ok: false, error: message };
}

/** 기본정보 수정 — 명·발주처·연도·코드·기간·예산·설명 (PM급 이상) */
export async function updateProjectBasicInfo(
  projectId: string,
  input: ProjectCreateInput
): Promise<BasicResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireProjectEditor(projectId);
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

  const { data: before } = await supabase
    .from("projects")
    .select("name, business_year, client_name, code, starts_on, ends_on, budget_amount")
    .eq("id", projectId)
    .maybeSingle();
  if (!before) {
    return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  }

  // 이름·코드 중복 가드 — **바뀐 값에만** 건다 (리뷰 4). 기존 중복 데이터가
  // 있는 상태에서 예산·기간만 고치는 저장까지 막으면 정리 자체가 불가능해진다.
  // 자기 자신·취소 보관 건은 제외, 대소문자 차이는 ilike로 잡는다 (리뷰 5).
  const admin = createAdminClient();
  const practice = practiceFromUser(user);
  const nameChanged =
    before.name.toLowerCase() !== data.name.toLowerCase() ||
    before.business_year !== parseInt(data.businessYear, 10);
  const newCode = data.code ?? "";
  const codeChanged = newCode !== "" && before.code !== newCode;
  const [{ data: sameName }, { data: sameCode }] = await Promise.all([
    nameChanged
      ? admin
          .from("projects")
          .select("id")
          .eq("tenant_id", gate.tenantId)
          .eq("is_practice", practice)
          .ilike("name", data.name)
          .eq("business_year", parseInt(data.businessYear, 10))
          .neq("id", projectId)
          .neq("status", "cancelled")
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    codeChanged
      ? admin
          .from("projects")
          .select("id")
          .eq("tenant_id", gate.tenantId)
          .eq("is_practice", practice)
          .eq("code", newCode)
          .neq("id", projectId)
          .neq("status", "cancelled")
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
 * 보관 처리 (기획 확정 2026-08-30) — 기록이 있어 삭제할 수 없는 중복·오생성
 * 건을 '취소' 상태로 전환해 별도 공간(설정 > 프로젝트 보관)으로 이관한다.
 * 데이터는 전량 보존된다(§14-4 — 삭제 대신 상태 전환). 대표·이사 전용,
 * 사유 필수(§14-3 위험 작업).
 */
export async function archiveProject(
  projectId: string,
  note: string
): Promise<BasicResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requireExecutive();
  if (!gate.ok) return gate;
  const trimmed = note.trim();
  if (!trimmed) {
    return { ok: false, error: "보관(취소) 처리에는 사유 입력이 필수입니다." };
  }

  const supabase = createClient();
  const { data: before } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!before) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (before.status === "completed" || before.status === "cancelled") {
    return {
      ok: false,
      error: "이미 종결·보관된 프로젝트입니다. 설정 > 프로젝트 보관에서 확인하세요.",
    };
  }

  const { data: updated, error } = await supabase
    .from("projects")
    .update({ status: "cancelled" })
    .eq("id", projectId)
    .eq("status", before.status)
    .select("id");
  if (error || !updated || updated.length === 0) {
    return {
      ok: false,
      error: "보관 처리에 실패했습니다 (다른 변경과 겹쳤거나 시스템 오류). 새로고침 후 다시 시도해 주세요.",
    };
  }

  await supabase.from("audit_logs").insert({
    tenant_id: gate.tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: "project.archive",
    resource_type: "project",
    resource_id: projectId,
    before_data: { status: before.status },
    after_data: { status: "cancelled", note: trimmed },
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
    .select("id, tenant_id, name, code, business_year, status")
    .eq("id", projectId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  }
  // 종결·보류·취소 처리된 프로젝트는 이미 '기록'이다 — 보관으로만 관리
  if (project.status !== "planned" && project.status !== "active") {
    return {
      ok: false,
      error:
        "종결·보류·취소 처리된 프로젝트는 삭제할 수 없습니다 (기록 보존 규칙). 설정 > 프로젝트 보관에서 확인하세요.",
    };
  }

  // 실적 존재 검사 — 하나라도 있으면 삭제 불가.
  // approvals는 FK가 set null이라 삭제 시 결재함에 고아가 남는다 (리뷰 1) —
  // 기여도(project_contributions)도 실적이다.
  const [
    { count: slots },
    { count: engagements },
    { count: plans },
    { count: approvals },
    { count: contributions },
  ] = await Promise.all([
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
    admin
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    admin
      .from("project_contributions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);
  if (
    (slots ?? 0) > 0 ||
    (engagements ?? 0) > 0 ||
    (plans ?? 0) > 0 ||
    (approvals ?? 0) > 0 ||
    (contributions ?? 0) > 0
  ) {
    return {
      ok: false,
      error:
        "세션·섭외·품의·결재·기여도 기록이 있는 프로젝트는 삭제할 수 없습니다 (기록 보존 규칙). 잘못 만든 중복 건이라면 이 창의 '보관 처리'로 취소 상태로 이관하세요 — 데이터는 보존되고 설정 > 프로젝트 보관에서 관리됩니다.",
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
