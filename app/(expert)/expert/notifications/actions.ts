"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type NotificationActionResult = { ok: true } | { ok: false; error: string };

/** 단건 읽음 처리 (본인 알림 — RLS). */
export async function markNotificationRead(
  id: string
): Promise<NotificationActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) return { ok: false, error: "처리에 실패했습니다." };
  revalidatePath("/expert/notifications");
  revalidatePath("/expert", "layout");
  return { ok: true };
}

/** 전체 읽음 처리 (본인 알림 — RLS). */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase
    .from("expert_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return { ok: false, error: "처리에 실패했습니다." };
  revalidatePath("/expert/notifications");
  revalidatePath("/expert", "layout");
  return { ok: true };
}
