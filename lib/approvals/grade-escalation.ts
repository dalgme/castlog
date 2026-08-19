import "server-only";

import { createClient } from "@/lib/supabase/server";
import { GRADE_LABELS, USER_GRADES, gradeRank, isUserGrade } from "@/lib/auth/grades";

import type { EngineLineStep } from "./engine";

/**
 * 상위직급 자동 결재선 (전결규정 폴백)
 *
 * 왜 필요한가: 출장품의처럼 실무자가 수시로 올리는 건은, 전결규정이 아직
 * 등록되지 않았다는 이유로 **상신 자체가 막히면 안 된다.** 그렇다고 결재 없이
 * 통과시킬 수도 없다. 그래서 규정이 없을 때는 직급 체계를 따라 위로 올린다.
 *
 * 구성 규칙
 *  1) 1차: 상신자보다 높은 직급 중 **가장 가까운** 직급의 담당자
 *  2) 금액이 큰 건은 그 위에 이사를 한 단계 더 둔다
 *  3) 마지막은 항상 대표
 *  중복은 제거하고 순서를 유지한다(같은 사람이 두 번 결재하지 않는다).
 *
 * 한계(화면에 그대로 안내한다): 같은 직급이 여러 명이면 **가장 먼저 등록된 사람**이
 * 지정된다. 누구에게 갈지 회사가 정하려면 전결규정을 등록해야 한다. 임의로 고른
 * 사람을 '정해진 결재선'인 척 보여주지 않는다.
 */

/** 이 금액 이상이면 이사 단계를 한 번 더 거친다 */
export const ESCALATION_DIRECTOR_THRESHOLD = 500_000;

export type EscalationLine = {
  steps: EngineLineStep[];
  /** 화면 안내용 — "김이사(이사) → 박대표(대표)" */
  description: string;
  /** 대표가 스스로 결재하는 건인가 (1인 기업·상위 결재자 없음) */
  selfApproved?: boolean;
};

type Candidate = { id: string; name: string; grade: string };

export async function buildGradeEscalationLine(
  requesterUserId: string,
  amount: number | null
): Promise<EscalationLine | null> {
  const supabase = createClient();

  const { data: requester } = await supabase
    .from("users")
    .select("grade")
    .eq("id", requesterUserId)
    .maybeSingle();
  const requesterGrade = isUserGrade(requester?.grade ?? "")
    ? (requester!.grade as (typeof USER_GRADES)[number])
    : "staff";
  const requesterRank = gradeRank(requesterGrade);

  // 활성 직원 중 상신자보다 높은 직급만. 등록 순서를 유지해 선택이 흔들리지 않게 한다.
  const { data: staff } = await supabase
    .from("users")
    .select("id, name, grade")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const superiors: Candidate[] = (staff ?? [])
    .filter((u) => u.id !== requesterUserId)
    .filter((u) => isUserGrade(u.grade) && gradeRank(u.grade) > requesterRank);

  // 상급자가 아무도 없는 경우 — 1인 기업이거나 대표가 직접 올린 건이다.
  // 대표는 회사의 최종 결재권자이므로 스스로 결재할 수 있어야 한다. 결재를
  // '남의 승인'으로만 정의하면 1인 기업은 아무것도 상신할 수 없다.
  // 다만 사원·팀장이 자기 건을 스스로 결재하는 것은 여전히 막는다 —
  // 여기 도달하는 비-대표는 상급자가 없다는 뜻이므로 거부한다.
  if (superiors.length === 0) {
    if (requesterGrade !== "ceo") return null;
    return {
      steps: [
        { stepOrder: 1, stepKind: "approval" as const, approverUserId: requesterUserId },
      ],
      description: "대표 자가결재 (상위 결재자 없음)",
      selfApproved: true,
    };
  }

  /** 특정 직급의 대표 1인 (가장 먼저 등록된 사람) */
  const firstOfGrade = (grade: string): Candidate | null =>
    superiors.find((u) => u.grade === grade) ?? null;

  /** 상신자 바로 위 직급부터 위로 훑어 처음 사람이 있는 직급 */
  const nearestSuperior = (): Candidate | null => {
    const above = [...USER_GRADES]
      .filter((g) => gradeRank(g) > requesterRank)
      .sort((a, b) => gradeRank(a) - gradeRank(b));
    for (const g of above) {
      const found = firstOfGrade(g);
      if (found) return found;
    }
    return null;
  };

  const picked: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c && !picked.some((p) => p.id === c.id)) picked.push(c);
  };

  push(nearestSuperior());
  if (amount !== null && amount >= ESCALATION_DIRECTOR_THRESHOLD) {
    push(firstOfGrade("director"));
  }
  push(firstOfGrade("ceo"));

  if (picked.length === 0) return null;

  return {
    selfApproved: false,
    steps: picked.map((c, i) => ({
      stepOrder: i + 1,
      stepKind: "approval" as const,
      approverUserId: c.id,
    })),
    description: picked
      .map((c) => `${c.name}(${GRADE_LABELS[c.grade as (typeof USER_GRADES)[number]] ?? c.grade})`)
      .join(" → "),
  };
}
