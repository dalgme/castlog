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
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return false;
  // 반드시 JWT 테넌트로 좁힌다 — 전문가 겸직·플랫폼 관리자 세션은 RLS로
  // 여러 tenants 행이 보여 maybeSingle()이 에러 → 기능이 늘 꺼짐으로
  // 오판된다 (리뷰 P2-1)
  const { data } = await supabase
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();
  return parseExtraFeatures(data?.feature_flags)[feature];
}
