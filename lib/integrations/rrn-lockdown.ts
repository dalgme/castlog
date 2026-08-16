import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { resolveEmailProvider } from "@/lib/email/provider";

export type LockdownState = {
  locked: boolean;
  reason?: string;
  triggeredAt?: string;
};

/** 현재 주민번호 조회가 잠금 상태인지 (미해제 tax_lockdown 행 존재 여부). */
export async function getRrnLockdown(): Promise<LockdownState> {
  if (!hasSupabaseEnv()) return { locked: false };
  const admin = createAdminClient();
  const { data } = await admin
    .from("tax_lockdown")
    .select("reason, triggered_at")
    .is("resolved_at", null)
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { locked: false };
  return { locked: true, reason: data.reason, triggeredAt: data.triggered_at };
}

/**
 * 전체 잠금 트리거 — 허니토큰 접근 감지 등. 모든 주민번호 조회를 즉시 차단한다.
 * 감사로그도 남긴다(경보 기록). 이미 잠금이면 트리거만 추가 기록.
 */
export async function tripRrnLockdown(params: {
  reason: string;
  honeytokenId?: string | null;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;
  try {
    const admin = createAdminClient();
    await admin.from("tax_lockdown").insert({
      reason: params.reason,
      honeytoken_id: params.honeytokenId ?? null,
      triggered_by_user: params.userId ?? null,
      triggered_tenant: params.tenantId ?? null,
    });
    await admin.from("audit_logs").insert({
      tenant_id: params.tenantId ?? null,
      actor_auth_user_id: params.userId ?? null,
      actor_role: "system",
      action: "rrn.lockdown.triggered",
      resource_type: "tax_lockdown",
      resource_id: params.honeytokenId ?? null,
      after_data: { reason: params.reason },
    });

    // 운영 경보 — 넥스트랩 운영자에게 즉시 통지(구성 시). 미구성이면 감사로그만.
    await sendLockdownAlert(params);
  } catch {
    // 잠금 기록·경보 실패도 조회는 계속 차단되어야 하므로 예외를 삼킨다.
  }
}

/** 잠금 발생 경보 이메일 — RRN_ALERT_EMAIL 구성 시 발송(best-effort). */
async function sendLockdownAlert(params: {
  reason: string;
  tenantId?: string | null;
}): Promise<void> {
  const to = process.env.RRN_ALERT_EMAIL;
  const provider = resolveEmailProvider();
  if (!to || !provider) return;
  const from = process.env.EMAIL_FROM ?? "CASTLOG <noreply@castlog.kr>";
  await provider.send({
    from,
    to,
    subject: "[긴급] 주민번호 조회 전체 잠금이 발생했습니다",
    text:
      `주민등록번호 조회 서브시스템이 자동 잠금되었습니다.\n\n` +
      `사유: ${params.reason === "honeytoken" ? "허니토큰 접근 감지(비정상 접근 의심)" : params.reason}\n` +
      `테넌트: ${params.tenantId ?? "-"}\n\n` +
      `모든 주민번호 조회가 차단된 상태입니다. 플랫폼 관리 화면에서 원인을 확인하고 해제하세요.\n`,
  });
}

/** 잠금 해제 — 플랫폼 운영자만 호출(호출측에서 권한 확인). 미해제 행 전체 해제. */
export async function resolveRrnLockdown(
  userId: string,
  note: string
): Promise<void> {
  if (!hasSupabaseEnv()) return;
  const admin = createAdminClient();
  await admin
    .from("tax_lockdown")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolved_note: note || null,
    })
    .is("resolved_at", null);
}
