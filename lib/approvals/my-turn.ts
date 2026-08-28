import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * 내 결재 차례 (검수 A3 — CEO에게 "결재할 것이 왔다"는 신호가 없던 문제).
 *
 * 섭외계획 품의는 승인 전 발송을 막는 게이트라, 결재권자가 도착을 모르면
 * 팀 전체가 멈춘다. '내 업무'와 사이드바 배지가 이 목록을 쓴다.
 *
 * 판정 규칙은 전자결재 목록 화면과 동일하다: in_progress 결재의 pending
 * 스텝 중 최소 step_order(현재 차례)에 내가 있으면 내 차례다(병렬 합의 포함).
 */
export type MyTurnApproval = {
  id: string;
  title: string;
  approvalType: string;
  createdAt: string;
  requesterName: string | null;
};

export async function getMyTurnApprovals(
  userId: string
): Promise<MyTurnApproval[]> {
  if (!hasSupabaseEnv() || !userId) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("approvals")
    .select(
      "id, title, approval_type, status, created_at, users!approvals_requester_user_id_fkey (name), approval_steps (step_order, status, approver_user_id)"
    )
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(100);

  const mine: MyTurnApproval[] = [];
  for (const a of data ?? []) {
    const pending = (a.approval_steps ?? []).filter(
      (s) => s.status === "pending"
    );
    if (pending.length === 0) continue;
    const currentOrder = Math.min(...pending.map((s) => s.step_order));
    const myTurn = pending.some(
      (s) => s.step_order === currentOrder && s.approver_user_id === userId
    );
    if (!myTurn) continue;
    mine.push({
      id: a.id,
      title: a.title,
      approvalType: a.approval_type,
      createdAt: a.created_at,
      requesterName: a.users?.name ?? null,
    });
  }
  return mine;
}
