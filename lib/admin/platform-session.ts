import "server-only";

import { createClient } from "@/lib/supabase/server";
import { roleFromUser } from "@/lib/auth/tenant";

export type PlatformAdminSession =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/** 현재 세션이 플랫폼관리자인지 확인 (JWT app_metadata 기준 — CLAUDE.md §3) */
export async function requirePlatformAdminSession(): Promise<PlatformAdminSession> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}
