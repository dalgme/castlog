import "server-only";

import type { User } from "@supabase/supabase-js";

import type { createClient } from "@/lib/supabase/server";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";

/**
 * 감사로그 공통 기록 (설계문서 4.2 — INSERT 전용 테이블)
 *
 * 데이터 내보내기처럼 여러 곳에서 같은 형태로 기록하는 행위용 헬퍼.
 * 민감정보 평문을 after_data에 넣지 않는다 (건수·유형 등 메타데이터만).
 */
export async function logAudit(
  supabase: ReturnType<typeof createClient>,
  user: User | null,
  entry: {
    action: string;
    resourceType: string;
    resourceId?: string;
    afterData?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  if (!user) return;
  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    after_data: entry.afterData ?? null,
  });
}
