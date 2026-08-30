import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import {
  GRADE_LABELS,
  USER_GRADES,
  gradeRank,
  isUserGrade,
  type UserGrade,
} from "@/lib/auth/grades";

import type { EngineLineStep } from "./engine";

/**
 * 상급자 릴레이 결재 (기획 확정 2026-08-30 — 27번).
 *
 * 섭외계획 품의를 상신하면, 결재 단계를 특정인이 아니라 **직급**으로 구성한다:
 * 상신자보다 높은 직급(재직자가 있는 직급만) 하나당 한 단계, 마지막은 대표
 * 직급. 각 단계는 그 직급 이상 누구나 결재할 수 있고, 결재하면 기존 단계
 * 진행 로직에 따라 다음 상급 직급이 자동으로 열린다.
 *
 * 활성화는 전자결재 메뉴의 스위치(tenants.feature_flags.approval_plan_relay).
 * 우선순위: 결재라인 직접 지정(18번) > 릴레이(켠 경우) > 전결규정 > 직급 폴백.
 * — 스위치를 켠 회사는 '규정 대신 직급 릴레이로 돌린다'는 명시적 선택이다.
 */

export const PLAN_RELAY_FLAG = "approval_plan_relay";

function parseRelayFlag(featureFlags: unknown): boolean {
  if (
    featureFlags === null ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return false;
  }
  return (
    (featureFlags as Record<string, unknown>)[PLAN_RELAY_FLAG] === true
  );
}

/** 세션 테넌트의 릴레이 스위치 상태 — 실패는 꺼짐 */
export async function isPlanRelayEnabled(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return false;
  // JWT 테넌트로 좁힌다 — 겸직·관리자 세션의 다중 행 오판 방지 (23~26 리뷰 P2-1)
  const { data } = await supabase
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();
  return parseRelayFlag(data?.feature_flags);
}

export type RelayLine = {
  steps: EngineLineStep[];
  /** 화면 안내용 — "팀장 → 이사 → 대표 (각 직급 이상 누구나)" */
  description: string;
};

/**
 * 직급 릴레이 결재선 구성.
 * 상신자보다 높은 직급 중 활성 재직자가 있는 직급만 낮은 순으로 단계화한다.
 * 상급자가 아무도 없으면 null — 호출자가 기존 폴백(규정→직급 폴백)으로 넘긴다.
 */
export async function buildGradeRelayLine(
  requesterUserId: string
): Promise<RelayLine | null> {
  const supabase = createClient();

  const { data: requester } = await supabase
    .from("users")
    .select("grade")
    .eq("id", requesterUserId)
    .maybeSingle();
  const requesterGrade: UserGrade = isUserGrade(requester?.grade ?? "")
    ? (requester!.grade as UserGrade)
    : "staff";
  const requesterRank = gradeRank(requesterGrade);

  const { data: staff } = await supabase
    .from("users")
    .select("id, grade")
    .eq("is_active", true);

  const presentGrades = new Set(
    (staff ?? [])
      .filter((u) => u.id !== requesterUserId)
      .map((u) => u.grade)
      .filter(isUserGrade)
  );

  const tiers = [...USER_GRADES]
    .filter((g) => gradeRank(g) > requesterRank && presentGrades.has(g))
    .sort((a, b) => gradeRank(a) - gradeRank(b));

  if (tiers.length === 0) return null;

  return {
    steps: tiers.map((grade, i) => ({
      stepOrder: i + 1,
      stepKind: "approval" as const,
      approverUserId: null,
      stepGrade: grade,
    })),
    description:
      tiers.map((g) => GRADE_LABELS[g]).join(" → ") + " (각 직급 이상 누구나)",
  };
}
