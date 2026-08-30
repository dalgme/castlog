import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser, roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { type ExecFeature } from "@/lib/auth/exec-permissions";
import { canExecWithPolicy, getExecPolicy } from "@/lib/auth/exec-policy";
import { deniedExec } from "@/lib/monitoring/action-denials";

export type ExecGateResult =
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; error: string };

/**
 * 실행 게이트 (기획 확정 2026-08-23 — 레벨 4·5·6 차등화).
 * 기능별 최소 레벨(lib/auth/exec-permissions)을 JWT grade로 판정한다.
 * grade 클레임이 아직 없는 구세션은 role에서 역산한다 (DB app.user_grade와 동일).
 * 모듈 게이트(requireModule)는 호출부가 따로 건다 — 축이 다르다.
 */
export async function requireExecGrade(
  feature: ExecFeature
): Promise<ExecGateResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  // 회사 조정 레벨·개인 지정까지 반영해 판정한다 (기본값은 EXEC_FEATURES)
  const policy = await getExecPolicy(user.id);
  const grade = gradeFromUser(user);
  if (!canExecWithPolicy(policy, feature, grade, role)) {
    return {
      ok: false,
      error: await deniedExec(feature, policy.overrides[feature], user),
    };
  }
  return { ok: true, userId: user.id, tenantId, role };
}
