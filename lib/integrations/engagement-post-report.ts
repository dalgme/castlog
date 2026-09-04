import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { gradeRank, isUserGrade, type UserGrade } from "@/lib/auth/grades";
import { matchApprovalRule } from "@/lib/approvals/engine";

/**
 * 섭외 사후보고 모드 (기획 확정 2026-08-30 — 38번).
 *
 * 켜진 회사에서는 후보 배정을 마친 담당자가 **승인 없이 섭외를 확정**하고,
 * 상급자에게는 '사후보고' 문서(approvals.approval_kind='report')가 간다.
 * 상급자는 확인하거나 피드백을 남길 뿐, 이미 진행된 섭외를 되돌리지 않는다.
 *
 * 충돌 방지 원칙 (설계 문서 §3-2):
 *  · 실행 권한(planSubmit·engagementRequest)은 그대로 — 이 모드는 그 위에
 *    얹는 특례 문턱(min_grade)만 더한다.
 *  · 전결규정('프로젝트' 유형)이 잡는 금액 구간은 규정 우선 → 사전 품의.
 *  · 금액 상한(max_amount)을 넘으면 사전 품의.
 *  · 지급 품의는 무관(항상 사전 결재).
 */

export const POST_REPORT_FLAG = "engagement_post_report";

export type PostReportSettings = {
  enabled: boolean;
  /** 이 직급 이상만 사후보고로 진행 (기본: 대리) */
  minGrade: UserGrade;
  /** 계획 섭외비 상한 — null이면 무제한 */
  maxAmount: number | null;
};

export const DEFAULT_POST_REPORT: PostReportSettings = {
  enabled: false,
  minGrade: "deputy",
  maxAmount: null,
};

export function parsePostReportSettings(featureFlags: unknown): PostReportSettings {
  if (
    featureFlags === null ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return DEFAULT_POST_REPORT;
  }
  const raw = (featureFlags as Record<string, unknown>)[POST_REPORT_FLAG];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_POST_REPORT;
  }
  const r = raw as Record<string, unknown>;
  const maxAmount =
    typeof r.max_amount === "number" && Number.isFinite(r.max_amount) && r.max_amount >= 0
      ? Math.floor(r.max_amount)
      : null;
  return {
    enabled: r.enabled === true,
    minGrade: isUserGrade(r.min_grade) ? r.min_grade : DEFAULT_POST_REPORT.minGrade,
    maxAmount,
  };
}

/** 세션 테넌트의 사후보고 설정 — 실패·미설정은 꺼짐 */
export async function getPostReportSettings(): Promise<PostReportSettings> {
  if (!hasSupabaseEnv()) return DEFAULT_POST_REPORT;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return DEFAULT_POST_REPORT;
  // JWT 테넌트로 좁힌다 — 겸직·관리자 세션의 다중 행 오판 방지
  const { data } = await supabase
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();
  return parsePostReportSettings(data?.feature_flags);
}

export type PlanFlow =
  | { mode: "post_report" }
  | { mode: "pre_approval"; reason: string | null };

/**
 * 사전 품의 vs 사후보고 판정 — 화면 버튼과 서버 상신 액션이 같은 함수를 본다.
 * approvals 모듈이 꺼진 회사는 호출하지 않는다(그 경우는 문서 자체가 없다).
 *
 *  1. 모드 꺼짐                          → pre_approval (사유 없음 = 기본 흐름)
 *  2. 상신자 직급 < min_grade             → pre_approval (사유 표기)
 *  3. max_amount 있고 금액 초과            → pre_approval (사유 표기)
 *  4. 전결규정('project')이 금액 구간을 잡음 → pre_approval (규정 우선)
 *  5. 그 외                               → post_report
 */
export async function decidePlanFlow(input: {
  amount: number;
  requesterGrade: string | null;
  settings?: PostReportSettings;
}): Promise<PlanFlow> {
  const settings = input.settings ?? (await getPostReportSettings());
  if (!settings.enabled) return { mode: "pre_approval", reason: null };

  const grade = isUserGrade(input.requesterGrade) ? input.requesterGrade : null;
  if (!grade || gradeRank(grade) < gradeRank(settings.minGrade)) {
    return {
      mode: "pre_approval",
      reason: "사후보고 특례는 회사가 정한 직급 이상만 쓸 수 있습니다 (규칙). 이 상신은 사전 품의로 올라갑니다.",
    };
  }
  if (settings.maxAmount !== null && input.amount > settings.maxAmount) {
    return {
      mode: "pre_approval",
      reason: `계획 섭외비가 사후보고 상한(${settings.maxAmount.toLocaleString("ko-KR")}원)을 넘어 사전 품의로 올라갑니다 (규칙).`,
    };
  }
  const rule = await matchApprovalRule("project", input.amount);
  if (rule) {
    return {
      mode: "pre_approval",
      reason: "이 금액 구간은 전결규정이 정해져 있어 규정대로 사전 품의로 올라갑니다 (규칙).",
    };
  }
  return { mode: "post_report" };
}
