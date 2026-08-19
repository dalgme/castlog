"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 본인 정보 수정 — 이름·연락처만.
 *
 * 직급·부서·계정 상태는 여기서 손대지 않는다. 서버 액션이 안 보내도 DB 트리거
 * (app.block_self_privilege_change)가 한 번 더 막는다 — 방어선을 화면 코드에만
 * 두면 언젠가 뚫린다.
 */
const profileSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(50),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9-]*$/, "숫자와 하이픈만 입력하세요.")
    .optional()
    .or(z.literal("")),
});

export type ProfileResult = { ok: true } | { ok: false; error: string };

export async function updateMyProfile(
  _prev: ProfileResult | null,
  formData: FormData
): Promise<ProfileResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정 대기 중입니다." };

  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("users")
    .update({
      name: parsed.data.name,
      phone: parsed.data.phone ? parsed.data.phone : null,
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/[tenantSlug]/settings/me", "page");
  return { ok: true };
}
