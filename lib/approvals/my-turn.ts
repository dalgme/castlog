import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { gradeFromUser } from "@/lib/auth/tenant";
import { gradeRank, isUserGrade } from "@/lib/auth/grades";

/**
 * 내 결재 차례 (검수 A3 — CEO에게 "결재할 것이 왔다"는 신호가 없던 문제).
 *
 * 섭외계획 품의는 승인 전 발송을 막는 게이트라, 결재권자가 도착을 모르면
 * 팀 전체가 멈춘다. '내 업무'와 사이드바 배지가 이 목록을 쓴다.
 *
 * 판정 규칙은 전자결재 목록 화면과 동일하다: in_progress 결재의 pending
 * 스텝 중 최소 step_order(현재 차례)에 내가 있으면 내 차례다(병렬 합의 포함).
 * **대결(위임)도 포함한다** — 대결자가 배지 0을 보면 부재 중 대표의 결재가
 * 그대로 멈춘다 (검수 리뷰 1).
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
  const [
    { data },
    { data: myDelegations },
    {
      data: { user: sessionUser },
    },
  ] = await Promise.all([
    supabase
      .from("approvals")
      .select(
        "id, title, approval_type, status, created_at, requester_user_id, users!approvals_requester_user_id_fkey (name), approval_steps (step_order, status, approver_user_id, step_grade)"
      )
      .eq("status", "in_progress")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("approval_delegations")
      .select("delegator_user_id, starts_on, ends_on")
      .eq("delegate_user_id", userId)
      .eq("is_active", true),
    supabase.auth.getUser(),
  ]);
  // 직급 릴레이 단계 판정용 (27번) — 이 함수는 항상 세션 본인 기준으로 불린다
  const myGrade =
    sessionUser && sessionUser.id === userId ? gradeFromUser(sessionUser) : null;

  const today = new Date().toISOString().slice(0, 10);
  const myDelegatorIds = new Set(
    (myDelegations ?? [])
      .filter((d) => d.starts_on <= today && today <= d.ends_on)
      .map((d) => d.delegator_user_id)
  );

  const mine: MyTurnApproval[] = [];
  for (const a of data ?? []) {
    const pending = (a.approval_steps ?? []).filter(
      (s) => s.status === "pending"
    );
    if (pending.length === 0) continue;
    const currentOrder = Math.min(...pending.map((s) => s.step_order));
    const myTurn = pending.some(
      (s) =>
        s.step_order === currentOrder &&
        (s.approver_user_id === userId ||
          (s.approver_user_id !== null &&
            myDelegatorIds.has(s.approver_user_id)) ||
          // 직급 릴레이 단계 (27번) — 그 직급 이상 누구나, 상신자 본인 제외
          (s.approver_user_id === null &&
            isUserGrade(s.step_grade) &&
            myGrade !== null &&
            gradeRank(myGrade) >= gradeRank(s.step_grade) &&
            a.requester_user_id !== userId))
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
