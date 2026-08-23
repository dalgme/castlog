"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { execDeniedMessage } from "@/lib/auth/exec-permissions";
import {
  canExecTenant,
  canExecWithPolicy,
  getExecPolicy,
} from "@/lib/auth/exec-policy";
import { gradeFromUser } from "@/lib/auth/tenant";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { gateDeputyAction } from "@/lib/integrations/deputy-approvals";
import {
  dispatchSessionNotice,
  getSessionNoticeContext,
} from "@/lib/integrations/session-notices";

export type NoticeResult = { ok: true } | { ok: false; error: string };


async function requireNoticeSession(): Promise<
  | { ok: true; userId: string; tenantId: string; role: string; grade: string | null }
  | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가·프로젝트 모듈이 모두 활성이어야 합니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!(await canExecTenant("sessionNotice", user))) {
    return { ok: false, error: execDeniedMessage("sessionNotice") };
  }
  return { ok: true, userId: user.id, tenantId, role, grade: gradeFromUser(user) };
}

/**
 * 세션 안내문자 등록.
 * scheduledAt이 없으면 즉시 발송하고, 있으면 예약 상태로 남겨 크론이 집어간다.
 * 두 경우 모두 같은 발송 경로(dispatchSessionNotice)를 쓴다.
 */
export async function createSessionNotice(input: {
  slotId: string;
  body: string;
  scheduledAt?: string;
  templateId?: string;
}): Promise<NoticeResult> {
  const auth = await requireNoticeSession();
  if (!auth.ok) return auth;

  const body = input.body.trim();
  if (!body) return { ok: false, error: "안내 문구를 입력하세요." };
  if (body.length > 2000) {
    return { ok: false, error: "안내 문구는 2000자 이내로 입력하세요." };
  }

  const context = await getSessionNoticeContext(input.slotId);
  if (!context || context.tenantId !== auth.tenantId) {
    return { ok: false, error: "세션을 찾을 수 없습니다." };
  }
  if (context.recipients.length === 0) {
    return {
      ok: false,
      error:
        "발송 대상이 없습니다. 섭외가 확정된 전문가가 있어야 하며, 휴대폰 번호가 등록되어 있어야 합니다.",
    };
  }

  // 부PM 실행 게이트 — 외부로 나가는 발송은 회수할 수 없다.
  const deputyGate = await gateDeputyAction({
    projectId: context.projectId,
    actionType: "engagement.session_sms",
    targetId: context.slotId,
  });
  if (!deputyGate.ok) return { ok: false, error: deputyGate.error };

  let scheduledAt: string | null = null;
  if (input.scheduledAt) {
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return { ok: false, error: "예약 시각을 확인하세요." };
    }
    if (when.getTime() <= Date.now()) {
      return { ok: false, error: "예약 시각은 현재보다 이후여야 합니다." };
    }
    scheduledAt = when.toISOString();
  }

  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("session_notices")
    .insert({
      tenant_id: auth.tenantId,
      project_id: context.projectId,
      slot_id: context.slotId,
      template_id: input.templateId || null,
      body_template: body,
      status: "scheduled",
      scheduled_at: scheduledAt,
      recipient_count: context.recipients.length,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: "등록에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: scheduledAt ? "session_notice.schedule" : "session_notice.send",
    resource_type: "session_notice",
    resource_id: created.id,
    after_data: {
      slot_id: context.slotId,
      recipients: context.recipients.length,
      scheduled_at: scheduledAt,
    },
  });

  if (!scheduledAt) {
    const result = await dispatchSessionNotice(created.id);
    revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
    if (!result.ok) return result;
    return { ok: true };
  }

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 예약 발송 중지 — 삭제하지 않고 상태 전환 (§14-4·§14-5). */
export async function cancelSessionNotice(
  noticeId: string
): Promise<NoticeResult> {
  const auth = await requireNoticeSession();
  if (!auth.ok) return auth;

  const supabase = createClient();
  const { data: notice } = await supabase
    .from("session_notices")
    .select("id, status")
    .eq("id", noticeId)
    .maybeSingle();
  if (!notice) return { ok: false, error: "안내문자 건을 찾을 수 없습니다." };
  if (notice.status !== "scheduled") {
    return { ok: false, error: "예약 대기 중인 건만 중지할 수 있습니다." };
  }

  const { error } = await supabase
    .from("session_notices")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_by: auth.userId,
    })
    .eq("id", noticeId)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: "중지에 실패했습니다." };

  await supabase.from("audit_logs").insert({
    tenant_id: auth.tenantId,
    actor_auth_user_id: auth.userId,
    actor_role: auth.role,
    action: "session_notice.cancel",
    resource_type: "session_notice",
    resource_id: noticeId,
  });

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 안내문자 템플릿 저장 (같은 이름이면 문구 갱신). */
export async function saveNoticeTemplate(
  name: string,
  body: string
): Promise<NoticeResult> {
  const auth = await requireNoticeSession();
  if (!auth.ok) return auth;
  // 문구 관리는 설정 성격 — 발송 실행보다 문턱이 높다 (회사 조정 반영)
  const policy = await getExecPolicy(auth.userId);
  if (!canExecWithPolicy(policy, "sendTemplate", auth.grade, auth.role)) {
    return {
      ok: false,
      error: execDeniedMessage("sendTemplate", policy.overrides.sendTemplate),
    };
  }

  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  if (!trimmedName) return { ok: false, error: "템플릿 이름을 입력하세요." };
  if (trimmedName.length > 50) {
    return { ok: false, error: "템플릿 이름은 50자 이내로 입력하세요." };
  }
  if (!trimmedBody) return { ok: false, error: "안내 문구를 입력하세요." };

  const supabase = createClient();
  const { error } = await supabase.from("session_notice_templates").upsert(
    {
      tenant_id: auth.tenantId,
      name: trimmedName,
      body: trimmedBody,
      is_active: true,
      created_by: auth.userId,
    },
    { onConflict: "tenant_id,name" }
  );
  if (error) return { ok: false, error: "템플릿 저장에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 템플릿 비활성화 (삭제하지 않는다 — §14-4). */
export async function deactivateNoticeTemplate(
  templateId: string
): Promise<NoticeResult> {
  const auth = await requireNoticeSession();
  if (!auth.ok) return auth;
  // 문구 관리는 설정 성격 — 발송 실행보다 문턱이 높다 (회사 조정 반영)
  const policy = await getExecPolicy(auth.userId);
  if (!canExecWithPolicy(policy, "sendTemplate", auth.grade, auth.role)) {
    return {
      ok: false,
      error: execDeniedMessage("sendTemplate", policy.overrides.sendTemplate),
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("session_notice_templates")
    .update({ is_active: false })
    .eq("id", templateId);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };

  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
