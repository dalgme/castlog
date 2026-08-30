import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import {
  parseExtraFeatures,
  type TenantExtraFeature,
} from "./tenant-features";

/**
 * 현재 세션 테넌트의 추가 기능 상태 (서버 전용).
 * 조회 실패는 전부 꺼짐 — 예외 기능이 실수로 열리는 방향의 실패를 만들지 않는다.
 */
export async function isExtraFeatureEnabled(
  feature: TenantExtraFeature
): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!tenantIdFromUser(user)) return false;
  const { data } = await supabase
    .from("tenants")
    .select("feature_flags")
    .maybeSingle();
  return parseExtraFeatures(data?.feature_flags)[feature];
}
