import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { gradeAtLeast, isUserGrade, type UserGrade } from "@/lib/auth/grades";
import {
  EXEC_FEATURES,
  canExec,
  gradeFromLegacyRoleSafe,
  type ExecFeature,
} from "@/lib/auth/exec-permissions";

import {
  ASSIGNMENT_ROLE_MIN_DEFAULTS,
  isRuleRole,
  type RoleMinGrades,
} from "@/lib/integrations/assignment-role-rules";

import type { User } from "@supabase/supabase-js";

/**
 * 회사별 권한 문턱 조정 (기획 확정 2026-08-23 — 차등화 다음 단계).
 *
 * EXEC_FEATURES의 기본 최소 레벨 위에 두 겹을 얹는다:
 *  1. tenant_exec_overrides — 회사가 기능별 최소 레벨을 올리거나 내림
 *  2. tenant_exec_grants    — 레벨과 무관하게 특정 직원에게 기능을 열어줌
 *
 * 판정 순서: 개인 지정 > 회사 조정 레벨 > 기본 레벨.
 * DB의 app.can_exec(feature)가 같은 규칙으로 RLS를 강제한다 — 여기와 어긋나면
 * 화면은 열리는데 저장이 거부되는(또는 그 반대) 상태가 되므로 함께 고친다.
 *
 * 서버 전용 — 클라이언트 컴포넌트에는 판정 결과(boolean)만 내려보낸다.
 */

export type ExecOverrideRow = {
  feature: ExecFeature;
  minGrade: UserGrade;
};

/** 테넌트의 기능별 조정 레벨 + 현재 사용자의 개인 지정 목록 */
export type ExecPolicy = {
  overrides: Partial<Record<ExecFeature, UserGrade>>;
  myGrants: ReadonlySet<ExecFeature>;
};

function isExecFeature(value: unknown): value is ExecFeature {
  return typeof value === "string" && value in EXEC_FEATURES;
}

/**
 * 현재 세션 테넌트의 문턱 정책 조회.
 * 테이블 미생성(마이그레이션 전)·조회 실패 시 기본값으로 폴백한다 —
 * 정책 조회가 죽었다고 기능 전체가 죽으면 안 된다(부재 폴백, §14-10).
 */
export async function getExecPolicy(userId: string | null): Promise<ExecPolicy> {
  const empty: ExecPolicy = { overrides: {}, myGrants: new Set() };
  if (!hasSupabaseEnv()) return empty;

  const supabase = createClient();
  const [overridesResult, grantsResult] = await Promise.all([
    supabase.from("tenant_exec_overrides").select("feature, min_grade"),
    userId
      ? supabase
          .from("tenant_exec_grants")
          .select("feature")
          .eq("user_id", userId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const overrides: Partial<Record<ExecFeature, UserGrade>> = {};
  for (const row of overridesResult.data ?? []) {
    if (isExecFeature(row.feature) && isUserGrade(row.min_grade)) {
      overrides[row.feature] = row.min_grade;
    }
  }
  const myGrants = new Set<ExecFeature>();
  for (const row of grantsResult.data ?? []) {
    if (isExecFeature(row.feature)) myGrants.add(row.feature);
  }
  return { overrides, myGrants };
}

/** 정책이 이미 손에 있을 때의 순수 판정 (목록 화면에서 재사용) */
export function canExecWithPolicy(
  policy: ExecPolicy,
  feature: ExecFeature,
  grade: string | null | undefined,
  legacyRole?: string | null
): boolean {
  if (policy.myGrants.has(feature)) return true;
  const min = policy.overrides[feature];
  if (!min) return canExec(feature, grade, legacyRole);
  const resolved = isUserGrade(grade)
    ? grade
    : gradeFromLegacyRoleSafe(legacyRole);
  if (!resolved) return false;
  return gradeAtLeast(resolved, min);
}

/**
 * 회사 조정·개인 지정까지 반영한 기능 실행 판정 (서버 전용).
 * 기존 canExec(기본값 판정)을 대체하는 상위 판정이다.
 */
export async function canExecTenant(
  feature: ExecFeature,
  user: User | null
): Promise<boolean> {
  if (!user) return false;
  const policy = await getExecPolicy(user.id);
  return canExecWithPolicy(
    policy,
    feature,
    gradeFromUser(user),
    roleFromUser(user)
  );
}

/**
 * 프로젝트 역할별 최소 레벨 조회 (기본값 ← 회사 조정 tenant_assignment_role_rules).
 * 테이블 미생성·조회 실패 시 기본값 폴백 (부재 폴백, §14-10).
 */
export async function getAssignmentRoleMinGrades(): Promise<RoleMinGrades> {
  const mins: RoleMinGrades = { ...ASSIGNMENT_ROLE_MIN_DEFAULTS };
  if (!hasSupabaseEnv()) return mins;
  const supabase = createClient();
  const { data } = await supabase
    .from("tenant_assignment_role_rules")
    .select("assignment_role, min_grade");
  for (const row of data ?? []) {
    if (isRuleRole(row.assignment_role) && isUserGrade(row.min_grade)) {
      mins[row.assignment_role] = row.min_grade;
    }
  }
  return mins;
}

/** 한 화면에서 여러 기능 플래그가 필요할 때 — 정책 1회 조회로 일괄 판정 */
export async function getExecFlags<F extends ExecFeature>(
  user: User | null,
  features: readonly F[]
): Promise<Record<F, boolean>> {
  const flags = {} as Record<F, boolean>;
  if (!user) {
    for (const f of features) flags[f] = false;
    return flags;
  }
  const policy = await getExecPolicy(user.id);
  const grade = gradeFromUser(user);
  const role = roleFromUser(user);
  for (const f of features) {
    flags[f] = canExecWithPolicy(policy, f, grade, role);
  }
  return flags;
}
