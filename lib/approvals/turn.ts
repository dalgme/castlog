import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { gradeRank, isUserGrade, type UserGrade } from "@/lib/auth/grades";

/**
 * "이 단계가 지금 나에게 열려 있는가" — 결재 목록·내 차례 배지·처리 액션이
 * 같은 판정을 써야 한다. 판정이 갈리면 배지는 0인데 처리는 되거나(대결자),
 * 배지는 뜨는데 처리가 막히는 일이 난다 (감사 P3-1).
 *
 * 규칙 (DB app.can_act_grade_step / approval_steps_update와 동일):
 *  · 지정 결재자 본인, 또는 그 결재자의 유효한 대결자
 *  · 직급 릴레이 단계(approver_user_id null + step_grade): 그 직급 이상 본인,
 *    또는 그 직급 이상 위임자의 유효한 대결자 — 상신자 본인(·상신자 위임)은 제외
 */
export type TurnContext = {
  userId: string;
  myGrade: UserGrade | null;
  /** 오늘 유효한 대결 위임자들 (직급 포함 — 릴레이 단계 대결 판정용) */
  delegators: { id: string; grade: UserGrade | null }[];
};

type StepLike = {
  approver_user_id: string | null;
  step_grade: string | null;
};

export async function loadTurnContext(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  myGrade: string | null
): Promise<TurnContext> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: delegations } = await supabase
    .from("approval_delegations")
    .select("delegator_user_id, starts_on, ends_on")
    .eq("delegate_user_id", userId)
    .eq("is_active", true);
  const delegatorIds = Array.from(
    new Set(
      (delegations ?? [])
        .filter((d) => d.starts_on <= today && today <= d.ends_on)
        .map((d) => d.delegator_user_id)
    )
  );
  const { data: users } = delegatorIds.length
    ? await supabase
        .from("users")
        .select("id, grade")
        .in("id", delegatorIds)
        .eq("is_active", true)
    : { data: [] as { id: string; grade: string | null }[] };
  const gradeById = new Map((users ?? []).map((u) => [u.id, u.grade]));
  return {
    userId,
    myGrade: isUserGrade(myGrade) ? myGrade : null,
    delegators: delegatorIds.map((id) => {
      const g = gradeById.get(id) ?? null;
      return { id, grade: isUserGrade(g) ? g : null };
    }),
  };
}

export function isStepOpenFor(
  step: StepLike,
  requesterUserId: string,
  ctx: TurnContext
): boolean {
  if (step.approver_user_id !== null) {
    if (step.approver_user_id === ctx.userId) return true;
    return ctx.delegators.some((d) => d.id === step.approver_user_id);
  }
  if (!isUserGrade(step.step_grade)) return false;
  // 상신자 본인은 직급 경로 전체(본인·대결)에서 제외 — 처리 액션·DB 판정과
  // 동일 (리뷰 P2-1: 대결 경로만 열리면 배지는 뜨는데 처리는 거부된다)
  if (ctx.userId === requesterUserId) return false;
  const need = gradeRank(step.step_grade);
  if (ctx.myGrade !== null && gradeRank(ctx.myGrade) >= need) {
    return true;
  }
  return ctx.delegators.some(
    (d) =>
      d.id !== requesterUserId && d.grade !== null && gradeRank(d.grade) >= need
  );
}
