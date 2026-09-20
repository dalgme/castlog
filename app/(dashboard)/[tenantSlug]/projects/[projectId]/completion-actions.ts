"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { deniedExec } from "@/lib/monitoring/action-denials";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";

/**
 * 세션별·전문가별 종료 (기획 지시 2026-09-21) — 섭외 확정 탭.
 * 종료는 삭제·상태 전환이 아니라 completed_at 시각을 남기는 표시다 (§14-4).
 * 되돌릴 수 있다(종료 취소). 권한 축은 섭외 실행(engagementRequest)과 같다.
 * 컬럼 미적용 DB(SQL 먼저, §14-10)에서는 규칙 문구로 안내한다.
 */

const uuid = z.string().uuid();

type Result = { ok: true } | { ok: false; error: string };

const COLUMN_MISSING =
  "종료 기능이 아직 이 서버에 준비되지 않았습니다 (시스템 설정). 관리자에게 마이그레이션 적용을 요청해 주세요.";

async function requireCompletionSession(): Promise<
  { ok: true; userId: string; tenantId: string; role: string } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const modules = await getTenantModules();
  if (!modules.experts) return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canExecTenant("engagementRequest", user))) {
    return { ok: false, error: await deniedExec("engagementRequest") };
  }
  return { ok: true, userId: user.id, tenantId, role };
}

/** 전문가별 종료 / 종료 취소 — 계약 성립(accepted) 건만 */
export async function setEngagementCompleted(engagementId: string, done: boolean): Promise<Result> {
  if (!uuid.safeParse(engagementId).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }
  const auth = await requireCompletionSession();
  if (!auth.ok) return auth;
  const supabase = createClient();
  const { data: engagement } = await supabase
    .from("expert_engagements")
    .select("id, status, project_id")
    .eq("id", engagementId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!engagement) return { ok: false, error: "섭외 건을 찾을 수 없습니다." };
  if (engagement.status !== "accepted") {
    return { ok: false, error: "계약이 성립한(승인된) 건만 종료할 수 있습니다 (상태 미충족)." };
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("expert_engagements")
    .update({ completed_at: done ? now : null, completed_by: done ? auth.userId : null })
    .eq("id", engagementId)
    .eq("tenant_id", auth.tenantId);
  if (error) {
    return { ok: false, error: isMissingColumnError(error) ? COLUMN_MISSING : "종료 처리에 실패했습니다 (시스템 오류). 다시 시도해 주세요." };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: done ? "engagement.complete" : "engagement.reopen",
    resource_type: "expert_engagement",
    resource_id: engagementId,
    after_data: { project_id: engagement.project_id },
  });
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 세션별 종료 / 종료 취소 — 세션과 그 세션의 계약 성립 건을 함께 */
export async function setSlotCompleted(slotId: string, done: boolean): Promise<Result> {
  if (!uuid.safeParse(slotId).success) {
    return { ok: false, error: "대상을 확인할 수 없습니다 (시스템 결함). 새로고침 후 다시 시도해 주세요." };
  }
  const auth = await requireCompletionSession();
  if (!auth.ok) return auth;
  const supabase = createClient();
  const { data: slot } = await supabase
    .from("engagement_slots")
    .select("id, project_id")
    .eq("id", slotId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!slot) return { ok: false, error: "세션을 찾을 수 없습니다." };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("engagement_slots")
    .update({ completed_at: done ? now : null, completed_by: done ? auth.userId : null })
    .eq("id", slotId)
    .eq("tenant_id", auth.tenantId);
  if (error) {
    return { ok: false, error: isMissingColumnError(error) ? COLUMN_MISSING : "종료 처리에 실패했습니다 (시스템 오류). 다시 시도해 주세요." };
  }
  // 세션에 확정된 전문가도 함께 종료(취소) — 자리(코드넘버)에 붙은 계약 성립 건
  const { data: positions } = await supabase
    .from("engagement_slot_positions")
    .select("engagement_id")
    .eq("slot_id", slotId)
    .not("engagement_id", "is", null);
  const engagementIds = (positions ?? [])
    .map((p) => p.engagement_id)
    .filter((v): v is string => Boolean(v));
  if (engagementIds.length > 0) {
    await supabase
      .from("expert_engagements")
      .update({ completed_at: done ? now : null, completed_by: done ? auth.userId : null })
      .in("id", engagementIds)
      .eq("tenant_id", auth.tenantId)
      .eq("status", "accepted");
  }
  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: done ? "slot.complete" : "slot.reopen",
    resource_type: "engagement_slot",
    resource_id: slotId,
    after_data: { project_id: slot.project_id, engagement_ids: engagementIds },
  });
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
