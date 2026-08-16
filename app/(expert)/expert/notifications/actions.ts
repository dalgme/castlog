"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type NotificationActionResult = { ok: true } | { ok: false; error: string };

/**
 * 특정 카테고리의 안 읽은 알림을 읽음 처리한다.
 * 알림함을 없애는 대신, 각 탭(섭외 요청·서류함·외부 송신·조회 이력)을 열면
 * 그 탭이 담당하는 카테고리 알림이 읽음 처리되어 뱃지가 사라진다.
 */
export async function markNotificationsReadByCategory(
  categories: string[]
): Promise<NotificationActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const valid = (categories ?? []).filter(Boolean);
  if (valid.length === 0) return { ok: true };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .in("category", valid);
  if (error) return { ok: false, error: "처리에 실패했습니다." };
  revalidatePath("/expert", "layout");
  return { ok: true };
}
