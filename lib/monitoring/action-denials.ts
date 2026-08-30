import "server-only";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import {
  execDeniedMessage,
  type ExecFeature,
} from "@/lib/auth/exec-permissions";
import type { UserGrade } from "@/lib/auth/grades";
import { isMonitorActive } from "@/lib/monitoring/flags";
import { maskRrnInText } from "@/lib/crypto/rrn-mask";

/**
 * 규칙 거부 자동 기록 (기획 확정 2026-08-30 — 실시간 모니터링 후속).
 *
 * 사용자 테스트에서 "안 돼요"의 대부분은 에러가 아니라 규칙 거부인데, 지금까지
 * `{ok:false}`로 조용히 돌아가 어떤 기록에도 남지 않았다 — 모니터링 피드가
 * 정작 제일 잦은 막힘을 못 보는 구멍. 모니터링 창이 열린 테넌트에 한해
 * 거부를 audit_logs(action.denied)로 남겨 피드에 자동으로 띄운다.
 *
 * 원칙:
 * - best-effort: 기록 실패가 원래 액션의 거부 응답을 바꾸지 않는다 (전부 삼킴).
 * - 모니터링 창이 닫혀 있으면 아무것도 남기지 않는다 — 상시 행동 수집이 아니다.
 * - 문구는 마스킹 + 200자 제한 (§5 — 로그 파이프라인 최전단).
 * - 렌더용 판정(getExecFlags)에는 걸지 않는다. 액션의 거부 반환 지점에서만 부른다.
 */
export async function recordActionDenial(input: {
  /** 거부 축 — 예: "exec:engagementRequest" · "deputy:engagement.withdraw" · "scope:sending" · "practice:sending" · "rls" */
  kind: string;
  /** 사용자에게 돌려준 거부 문구 그대로 */
  message: string;
  resourceType?: string;
  resourceId?: string | null;
}): Promise<void> {
  try {
    if (!hasSupabaseEnv()) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const tenantId = tenantIdFromUser(user);
    if (!user || !tenantId) return;

    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant || !isMonitorActive(tenant.feature_flags)) return;

    // 어느 화면에서 막혔는지 — 서버 액션에는 pathname이 없어 referer로 짐작한다
    let path: string | null = null;
    try {
      const referer = headers().get("referer");
      path = referer ? new URL(referer).pathname : null;
    } catch {
      path = null;
    }

    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_auth_user_id: user.id,
      actor_role: roleFromUser(user),
      action: "action.denied",
      resource_type: input.resourceType ?? "action",
      resource_id: input.resourceId ?? null,
      after_data: {
        kind: input.kind,
        message: maskRrnInText(input.message).slice(0, 200),
        path,
      },
    });
  } catch {
    // 기록 실패는 삼킨다 — 거부 응답이 본체다
  }
}

/**
 * 실행 권한 거부 문구 + 자동 기록.
 * `return { ok: false, error: execDeniedMessage(f) }` 자리를 그대로 대체한다
 * (`await deniedExec(f)`) — 문구는 동일하고, 모니터링 창이 열려 있으면 기록이 남는다.
 */
export async function deniedExec(
  feature: ExecFeature,
  effectiveMin?: UserGrade
): Promise<string> {
  const message = execDeniedMessage(feature, effectiveMin);
  await recordActionDenial({ kind: `exec:${feature}`, message });
  return message;
}
