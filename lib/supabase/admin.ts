import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * service_role 관리자 클라이언트 — 서버 전용 (CLAUDE.md 11-9: 클라이언트 노출 절대 금지).
 *
 * 용도: app_metadata 스탬핑(role·tenant_id·tenant_slug), 계정 생성·초대 등
 * RLS를 우회해야 하는 관리 작업. 일반 데이터 접근에는 사용하지 않는다 —
 * RLS가 적용되는 server.ts 클라이언트가 기본이다.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다 (.env.example 참조 — 서버 전용)."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
