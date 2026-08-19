import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/auth/session";
import { tenantIdFromUser } from "@/lib/auth/tenant";

/**
 * 첫 로그인 안내 투어.
 *
 * 처음 들어온 사람에게 가장 필요한 건 기능 목록이 아니라 '어디서부터 손대야
 * 하는가'다. 그래서 네 장으로 끝낸다: 먼저 할 일 → 핵심 기능 셋 → 연습모드 →
 * 도우미. 그 이상은 읽지 않는다.
 *
 * 한 번 끝내면 다시 뜨지 않는다 (user_tour_acks). 사용자별로 기록하므로 같은
 * 회사의 다른 직원은 자기 차례에 처음부터 본다.
 */

export const WELCOME_TOUR_KEY = "welcome_v1";

export async function shouldShowWelcomeTour(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;

  const user = await getSessionUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return false;

  const supabase = createClient();
  const { data } = await supabase
    .from("user_tour_acks")
    .select("tour_key")
    .eq("user_id", user.id)
    .eq("tour_key", WELCOME_TOUR_KEY)
    .maybeSingle();

  return !data;
}
