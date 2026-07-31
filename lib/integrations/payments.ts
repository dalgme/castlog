import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 지급 배치 ↔ 결재 연동 훅 (experts ↔ approvals — CLAUDE.md 1-2-6)
 *
 * 결재 도메인은 지급 도메인을 직접 알지 않는다 — 결재 종결 시 이 모듈이
 * 연결된 지급 배치를 찾아 상태를 동기화한다.
 *  - 최종 승인 → 배치 '지급 확정(confirmed)'
 *  - 반려     → 배치 pending 복귀 + 반려 사유 기록 (수정 후 재상신 가능)
 */
export async function onPaymentApprovalResolved(
  approvalId: string,
  outcome: "approved" | "rejected",
  rejectionNote: string | null
): Promise<void> {
  const admin = createAdminClient();

  const { data: batch } = await admin
    .from("expert_payment_batches")
    .select("id, tenant_id, status")
    .eq("approval_id", approvalId)
    .maybeSingle();

  // 지급 배치와 연결되지 않은 일반 품의 — 아무 것도 하지 않는다
  if (!batch || batch.status !== "approval_in_progress") return;

  if (outcome === "approved") {
    await admin
      .from("expert_payment_batches")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", batch.id);
  } else {
    await admin
      .from("expert_payment_batches")
      .update({
        status: "pending",
        approval_id: null,
        last_rejection_note: rejectionNote ?? "반려됨 (사유 미기재)",
      })
      .eq("id", batch.id);
  }

  await admin.from("audit_logs").insert({
    tenant_id: batch.tenant_id,
    actor_auth_user_id: null, // 시스템 동기화 (결재 행위 자체는 별도 로그 존재)
    actor_role: "system",
    action:
      outcome === "approved"
        ? "payment_batch.confirm"
        : "payment_batch.approval_rejected",
    resource_type: "expert_payment_batch",
    resource_id: batch.id,
    after_data: { approval_id: approvalId },
  });
}
