import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { practiceFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { recordActionDenial } from "@/lib/monitoring/action-denials";
import { PRACTICE_BLOCKED, type PracticeBlockedKey } from "./mode";
import { ensurePracticeEnvironment } from "./seed";

/** 현재 세션이 연습모드인지 (JWT 기준). */
export async function isPracticeMode(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return practiceFromUser(user);
}

export type PracticeGuard = { ok: true } | { ok: false; error: string };

/**
 * 연습모드에서 실행되면 안 되는 동작의 서버 게이트.
 * 화면에서 버튼을 숨기는 것만으로는 부족하다 — 서버 액션을 직접 호출할 수 있다.
 */
export async function blockInPractice(
  key: PracticeBlockedKey
): Promise<PracticeGuard> {
  if (await isPracticeMode()) {
    // 모니터링 창이 열려 있으면 피드에 자동 기록 (규칙 거부 가시화)
    await recordActionDenial({
      kind: `practice:${key}`,
      message: PRACTICE_BLOCKED[key],
    });
    return { ok: false, error: PRACTICE_BLOCKED[key] };
  }
  return { ok: true };
}

export type PracticeSwitchResult =
  | { ok: true; practice: boolean }
  | { ok: false; error: string };

/**
 * 연습모드 진입·이탈.
 *
 * JWT app_metadata.practice를 서버(service_role)가 갱신하고 세션을 새로고침한다.
 * 클라이언트가 보낸 값을 그대로 믿지 않고, 기업 직원 계정인지부터 확인한다.
 *  - 전문가 계정: 연습 대상이 아니다 (연습 데이터는 기업 내부용).
 *  - 플랫폼관리자: 테넌트 소속이 아니므로 대상이 아니다.
 */
async function setPracticeClaim(next: boolean): Promise<PracticeSwitchResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const role = roleFromUser(user);
  const tenantId = tenantIdFromUser(user);
  if (!tenantId || !role || !["org_admin", "manager", "staff"].includes(role)) {
    return { ok: false, error: "기업 계정만 연습모드를 사용할 수 있습니다." };
  }

  // 진입 시 연습 환경을 보장한다(멱등). 데이터가 없는 빈 화면으로 들여보내면
  // 연습할 게 없다 — 가상 전문가·이력·프로젝트가 갖춰진 상태로 시작한다.
  if (next) {
    const seeded = await ensurePracticeEnvironment(tenantId);
    if (!seeded.ok) return { ok: false, error: seeded.error };
  }

  if (practiceFromUser(user) === next) {
    return { ok: true, practice: next };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      // role·grade·tenant_id는 그대로 유지한다 — 연습이라고 권한이 커지면 안 된다.
      practice: next,
    },
  });
  if (error) {
    return { ok: false, error: "연습모드 전환에 실패했습니다." };
  }

  // 새 클레임이 담긴 토큰으로 교체해야 RLS(app.is_practice)가 즉시 반영된다.
  await supabase.auth.refreshSession();

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: next ? "practice.enter" : "practice.exit",
    resource_type: "practice_mode",
    resource_id: null,
  });

  return { ok: true, practice: next };
}

export function enterPracticeMode(): Promise<PracticeSwitchResult> {
  return setPracticeClaim(true);
}

export function exitPracticeMode(): Promise<PracticeSwitchResult> {
  return setPracticeClaim(false);
}
