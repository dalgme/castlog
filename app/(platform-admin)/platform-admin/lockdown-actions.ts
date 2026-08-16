"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import { resolveRrnLockdown } from "@/lib/integrations/rrn-lockdown";

export type LockdownActionResult = { ok: true } | { ok: false; error: string };

/**
 * 주민번호 전체 잠금 해제 — 플랫폼 운영자(넥스트랩)만. 원인 확인 후 해제.
 * 플랫폼관리자는 주민번호를 조회할 수 없지만(§5), 잠금 해제는 운영 책임 범위다.
 */
export async function resolveLockdownAction(
  note: string
): Promise<LockdownActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼 운영자만 해제할 수 있습니다." };
  }
  if (!note.trim()) {
    return { ok: false, error: "해제 사유(원인 확인 내용)를 입력하세요." };
  }

  await resolveRrnLockdown(user.id, note.trim());
  revalidatePath("/platform-admin");
  return { ok: true };
}
