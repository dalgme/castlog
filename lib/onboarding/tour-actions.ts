"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import { WELCOME_TOUR_KEY } from "./welcome-tour";

export type TourAckResult = { ok: true } | { ok: false; error: string };

/** 안내 투어를 끝냈다고 표시 — 다시 뜨지 않는다 */
export async function ackWelcomeTour(): Promise<TourAckResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { error } = await supabase
    .from("user_tour_acks")
    .upsert(
      { user_id: user.id, tour_key: WELCOME_TOUR_KEY },
      { onConflict: "user_id,tour_key" }
    );
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]", "layout");
  return { ok: true };
}
