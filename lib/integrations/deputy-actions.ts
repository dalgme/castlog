/**
 * 부PM 실행 → PM 승인 (클라이언트 안전 상수)
 *
 * PM과 부PM은 업무를 나누지 않는다. 부PM이 할 수 있는 일 = PM이 할 수 있는 일이며,
 * 갈리는 것은 '실행 직전에 PM 승인이 필요한가'뿐이다.
 *
 * 여기 없는 작업은 게이트 대상이 아니다. 조회·검색·초안 작성처럼 되돌릴 수 있는
 * 일까지 승인을 걸면 부PM이 일을 못 한다 — 외부로 나가거나 되돌리기 어려운
 * 실행만 담는다 (CLAUDE.md §14-3 위험 작업 보호).
 */

export const DEPUTY_GATED_ACTIONS = {
  "engagement.request": {
    label: "섭외 요청 발송",
    targetType: "position",
    /** 왜 게이트인가 — 화면·요청 사유 입력란에 그대로 보여준다 */
    why: "전문가에게 직접 나가는 요청이고, 보낸 뒤에는 회수해도 상대가 이미 봅니다.",
  },
  "engagement.cancel": {
    label: "섭외 긴급 취소 (확정 후)",
    targetType: "engagement",
    why: "확정된 일정을 되돌리는 작업이라 전문가·현장 일정에 곧바로 영향을 줍니다.",
  },
  // 응답 전 회수는 확정 취소와 성격이 다르다 — 같은 유형에 묶으면 PM이
  // 받아 보는 승인 요청의 라벨·사유가 사실과 어긋난다 (리뷰 7, A1 재안내와 동일 원칙)
  "engagement.withdraw": {
    label: "섭외 요청 회수 (응답 전)",
    targetType: "engagement",
    why: "이미 발송된 동의 링크가 무효화됩니다. 전문가가 링크를 봤을 수 있습니다.",
  },
  "engagement.manual_accept": {
    label: "수동 섭외 완료(수락서 생성)",
    targetType: "engagement",
    why: "계약 성립으로 처리되어 수락서가 만들어지고 자리가 확정됩니다. 되돌리려면 긴급 취소가 필요합니다.",
  },
  "engagement.session_sms": {
    label: "세션 안내문자 발송",
    targetType: "slot",
    why: "외부로 나가는 발송이며 회수할 수 없습니다.",
  },
  // 재안내는 세션 문자가 아니라 섭외 건의 동의 링크 재발급이다 — 같은
  // action_type을 쓰면 대상 규약(slot vs engagement)이 갈려 승인이 호환되지
  // 않으므로 분리한다 (검수 A1).
  "engagement.remind": {
    label: "동의 링크 재안내",
    targetType: "engagement",
    why: "외부로 나가는 발송이며, 이전 동의 링크가 무효화됩니다.",
  },
  "payment_batch.create": {
    label: "지급건 생성",
    targetType: "project",
    why: "금액이 확정되는 단계라 이후 정정에 결재가 다시 필요합니다.",
  },
} as const;

export type DeputyGatedAction = keyof typeof DEPUTY_GATED_ACTIONS;

export function isDeputyGatedAction(value: string): value is DeputyGatedAction {
  return value in DEPUTY_GATED_ACTIONS;
}

export function deputyActionLabel(value: string): string {
  return isDeputyGatedAction(value) ? DEPUTY_GATED_ACTIONS[value].label : value;
}

export function deputyActionWhy(value: string): string | null {
  return isDeputyGatedAction(value) ? DEPUTY_GATED_ACTIONS[value].why : null;
}

export const ACTION_REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "PM 승인 대기",
  approved: "승인됨(미사용)",
  denied: "반려됨",
  consumed: "승인 후 실행 완료",
};

/** 소진 여부까지 반영한 표시 상태 */
export function actionRequestStatusLabel(
  status: string,
  consumedAt: string | null
): string {
  if (status === "approved" && consumedAt) return "승인 후 실행 완료";
  return ACTION_REQUEST_STATUS_LABELS[status] ?? status;
}
