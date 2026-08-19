/**
 * 섭외 진행 단계 (코드넘버 한 자리 기준) — 클라이언트·서버 공용.
 *
 * 왜 별도 개념인가: 한 자리의 상태는 한 테이블에 있지 않다. 계획 품의(approvals),
 * 코드넘버(engagement_slot_positions), 섭외 건(expert_engagements), 수락서
 * (engagement_acceptances)에 흩어져 있고, 담당자가 알고 싶은 것은 그 넷을 합친
 * "지금 어디까지 왔나" 하나다. 화면마다 조각을 따로 읽어 제각각 표기하면 같은
 * 자리가 화면마다 다르게 보인다. 판정을 여기 한 곳에 둔다.
 *
 * 단계는 앞에서 뒤로만 간다. 예외는 반려·긴급취소로, 흐름에서 빠지는 상태다.
 */

export const ENGAGEMENT_STAGES = [
  "assigned", // 임의 배정
  "plan_review", // 품의 중
  "plan_approved", // 결재 완료
  "requested", // 승인요청 (전문가에게 발송)
  "declined", // 반려 (전문가 거절)
  "accepted", // 승인 (전문가 수락)
  "letter_issued", // 수락서 생성(자동)
  "letter_sent", // 수락서 송신
  "confirmed", // 확정
  "canceled", // 긴급 취소
] as const;

export type EngagementStage = (typeof ENGAGEMENT_STAGES)[number];

export const ENGAGEMENT_STAGE_LABELS: Record<EngagementStage, string> = {
  assigned: "임의 배정",
  plan_review: "품의 중",
  plan_approved: "결재 완료",
  requested: "승인요청",
  declined: "반려",
  accepted: "승인",
  letter_issued: "수락서 생성",
  letter_sent: "수락서 송신",
  confirmed: "확정",
  canceled: "긴급 취소",
};

/** 범례에 함께 적는 한 줄 설명 — 이름만으로는 무엇을 기다리는지 알 수 없다 */
export const ENGAGEMENT_STAGE_DESCRIPTIONS: Record<EngagementStage, string> = {
  assigned: "코드넘버만 만들어 둔 자리. 아직 아무에게도 요청하지 않았습니다.",
  plan_review: "섭외계획 품의가 결재 진행 중입니다. 승인 전에는 요청을 보낼 수 없습니다.",
  plan_approved: "섭외계획이 승인되어 요청을 보낼 수 있는 상태입니다.",
  requested: "전문가에게 섭외 요청(동의 링크)을 보내고 회신을 기다립니다.",
  declined: "전문가가 거절했습니다. 다른 후보를 찾아야 합니다.",
  accepted: "전문가가 수락했습니다(계약 성립). 수락서가 자동 생성됩니다.",
  letter_issued: "수락서가 자동 생성되었습니다. 안내 정보를 보완해 송부하세요.",
  letter_sent: "수락서를 전문가에게 송부했습니다. 전문가 확인을 기다립니다.",
  confirmed: "전문가 확인·담당자 최종 확인까지 끝난 자리입니다.",
  canceled: "확정 이후 취소된 건입니다. 대체 인력을 즉시 찾아야 합니다.",
};

export type StageTone = "gray" | "amber" | "blue" | "green" | "red";

export const ENGAGEMENT_STAGE_TONE: Record<EngagementStage, StageTone> = {
  assigned: "gray",
  plan_review: "amber",
  plan_approved: "blue",
  requested: "amber",
  declined: "red",
  accepted: "blue",
  letter_issued: "blue",
  letter_sent: "blue",
  confirmed: "green",
  canceled: "red",
};

export const STAGE_TONE_CLASS: Record<StageTone, string> = {
  gray: "border-border bg-secondary text-muted-foreground",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  blue: "border-sky-300 bg-sky-50 text-sky-800",
  green: "border-green-300 bg-green-50 text-green-800",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** 계획 품의 상태 — evaluatePlanGate의 state를 그대로 받는다 */
export type PlanStageInput =
  | "module_off"
  | "none"
  | "in_progress"
  | "rejected"
  | "approved"
  | "changed";

/**
 * 한 자리의 현재 단계를 정한다.
 *
 * 뒤쪽(수락서·확정)부터 확인한다 — 이미 지나온 단계가 아니라 **가장 앞선 사실**이
 * 지금 상태이기 때문이다.
 */
export function deriveEngagementStage(input: {
  /** engagement_slot_positions.status */
  positionStatus: string;
  /** expert_engagements.status (없으면 null) */
  engagementStatus: string | null;
  /** engagement_acceptances.status (없으면 null) */
  acceptanceStatus: string | null;
  /** 프로젝트의 섭외계획 품의 상태 */
  planState: PlanStageInput;
}): EngagementStage {
  const { positionStatus, engagementStatus, acceptanceStatus, planState } = input;

  // 흐름에서 빠지는 상태가 먼저다 — 취소된 자리를 '확정'으로 보여 주면 안 된다
  if (engagementStatus === "canceled") return "canceled";
  if (engagementStatus === "declined") return "declined";

  if (acceptanceStatus === "confirmed") return "confirmed";
  if (acceptanceStatus === "sent" || acceptanceStatus === "signed") {
    return "letter_sent";
  }
  if (acceptanceStatus === "issued") return "letter_issued";

  // 수락은 됐는데 수락서 행이 아직 없는 짧은 순간
  if (engagementStatus === "accepted") return "accepted";
  if (engagementStatus === "requested") return "requested";

  // 아직 요청 전 — 계획 품의가 어디까지 왔는지가 그 자리의 상태다
  if (positionStatus === "open" || engagementStatus === null) {
    if (planState === "in_progress") return "plan_review";
    if (planState === "approved") return "plan_approved";
    // module_off / none / rejected / changed — 아직 요청을 보낼 수 없는 자리
    return "assigned";
  }

  return "assigned";
}
