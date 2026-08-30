"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import { notifyExpert } from "@/lib/experts/notifications";

/**
 * 전역 전문가 DB 관리 — 관리모드 서버 액션 (기획 2026-08-30).
 *
 * 경계: 여기서 다루는 것은 전역 프로필의 "플랫폼 이용 상태"뿐이다.
 * 프로필 내용은 전문가 본인 소유(§4 — 본인만 수정), 평가·이력은 테넌트
 * 격리, 주민번호·계좌·서류는 플랫폼관리자도 접근 불가(§5) — 전부 이
 * 파일의 범위 밖이며 앞으로도 여기에 넣지 않는다.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

/** 현재 세션이 플랫폼관리자인지 확인 (JWT app_metadata 기준) */
async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || roleFromUser(user) !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id };
}

const setActiveSchema = z.object({
  expertId: z.string().uuid(),
  active: z.boolean(),
  // 중지에는 사유 필수(§14-3), 재개는 선택
  note: z.string().trim().max(500).optional(),
});

/**
 * 전문가 이용 중지/재개.
 * - 중지: is_active=false + (auth 연결 시) 로그인 차단(ban) + 본인 통지
 * - 재개: is_active=true + ban 해제 + 본인 통지
 * 기존 연결·섭외 이력은 건드리지 않는다 (§14-4 — 삭제 대신 비활성화).
 */
export async function setExpertActive(input: {
  expertId: string;
  active: boolean;
  note?: string;
}): Promise<ActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
    };
  }
  const { expertId, active } = parsed.data;
  const note = parsed.data.note || null;
  if (!active && !note) {
    return { ok: false, error: "이용 중지에는 사유 입력이 필수입니다." };
  }

  const admin = createAdminClient();
  const { data: expert } = await admin
    .from("experts")
    .select("id, name, auth_user_id, is_active, is_practice")
    .eq("id", expertId)
    .maybeSingle();
  if (!expert) return { ok: false, error: "전문가를 찾을 수 없습니다." };
  if (expert.is_practice) {
    return { ok: false, error: "연습모드 가상 전문가는 관리 대상이 아닙니다." };
  }
  if (expert.is_active === active) return { ok: true };

  const { data: updated, error } = await admin
    .from("experts")
    .update({
      is_active: active,
      deactivated_at: active ? null : new Date().toISOString(),
      deactivation_note: active ? null : note,
    })
    .eq("id", expertId)
    .eq("is_active", expert.is_active)
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    return {
      ok: false,
      error: "저장에 실패했습니다 (다른 변경과 겹쳤거나 시스템 오류). 새로고침 후 다시 시도해 주세요.",
    };
  }

  // 인증 계정이 연결돼 있으면 로그인도 함께 막는다/푼다 (setStaffActive 전례).
  // 실패해도 is_active가 로그인 게이트에서 재판정하므로 차단은 유지된다.
  if (expert.auth_user_id) {
    try {
      await admin.auth.admin.updateUserById(expert.auth_user_id, {
        ban_duration: active ? "none" : "876000h",
      });
    } catch {
      // best-effort — 아래 감사 기록에 남는 사실이 본체다
    }
  }

  // 전역 행위 — tenant_id 없이 기록한다 (audit_logs.tenant_id nullable 설계)
  const { error: auditError } = await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: gate.userId,
    actor_role: "platform_admin",
    action: active ? "expert.activate" : "expert.deactivate",
    resource_type: "expert",
    resource_id: expertId,
    after_data: { note },
  });
  if (auditError) {
    console.warn("[expert-active] audit insert failed:", auditError.code);
  }

  // 본인 통지 (best-effort) — 당사자가 모르는 상태 변화를 만들지 않는다
  await notifyExpert({
    expertId,
    category: "system",
    title: active
      ? "캐스트로그 이용이 다시 시작되었습니다"
      : "캐스트로그 이용이 중지되었습니다",
    body: active
      ? "계정 이용이 재개되었습니다. 이용에 문제가 있으면 캐스트로그에 문의해 주세요."
      : "플랫폼 운영 기준에 따라 계정 이용이 중지되었습니다. 문의는 캐스트로그로 연락해 주세요.",
  });

  revalidatePath("/platform-admin/experts", "page");
  revalidatePath("/platform-admin/experts/[expertId]", "page");
  return { ok: true };
}
