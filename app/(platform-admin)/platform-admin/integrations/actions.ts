"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import {
  runConnectionChecks,
  type ConnectionCheck,
} from "@/lib/integrations/connection-checks";

export type CheckRunResult =
  | { ok: true; checks: ConnectionCheck[]; ranAt: string }
  | { ok: false; error: string };

/**
 * 연동 점검 실행 (플랫폼관리자 전용).
 *
 * 외부 API를 실제로 호출하므로 버튼을 눌렀을 때만 돈다. 환경변수는 플랫폼
 * 운영사가 관리하는 값이라 테넌트 사용자에게는 열지 않는다.
 */
export async function runChecks(): Promise<CheckRunResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "권한이 없습니다." };
  }

  const checks = await runConnectionChecks();
  return { ok: true, checks, ranAt: new Date().toISOString() };
}
