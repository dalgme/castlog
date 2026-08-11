import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 프로젝트 종료 품의 ↔ 결재 연동 훅 (operations ↔ approvals — CLAUDE.md 1-2-6)
 *
 * 결재 도메인은 프로젝트 도메인을 직접 알지 않는다 — 결재 종결 시 이 모듈이
 * 연결된 프로젝트(closing_approval_id)를 찾아 상태를 동기화한다.
 *  - 최종 승인 → 프로젝트 status='completed' + closed_at
 *  - 반려     → 연결 해제(closing_approval_id=null) → 수정 후 재상신 가능
 */
export async function onProjectClosingApprovalResolved(
  approvalId: string,
  outcome: "approved" | "rejected"
): Promise<void> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, tenant_id, status")
    .eq("closing_approval_id", approvalId)
    .maybeSingle();

  // 종료 품의와 연결되지 않은 일반 프로젝트 품의 — 아무 것도 하지 않는다
  if (!project || project.status === "completed" || project.status === "cancelled") {
    return;
  }

  if (outcome === "approved") {
    await admin
      .from("projects")
      .update({ status: "completed", closed_at: new Date().toISOString() })
      .eq("id", project.id);
  } else {
    await admin
      .from("projects")
      .update({ closing_approval_id: null })
      .eq("id", project.id);
  }

  await admin.from("audit_logs").insert({
    tenant_id: project.tenant_id,
    actor_auth_user_id: null, // 시스템 동기화 (결재 행위 자체는 별도 로그 존재)
    actor_role: "system",
    action:
      outcome === "approved" ? "project.close_confirm" : "project.close_rejected",
    resource_type: "project",
    resource_id: project.id,
    after_data: { approval_id: approvalId },
  });
}
