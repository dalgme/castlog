/** 전자결재 공통 상수 (approvals 모듈 — 설계문서 9장) */

export const APPROVAL_TYPES = [
  "general",
  "expense",
  "payment",
  "project",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Record<string, string> = {
  general: "일반 품의",
  expense: "지출 품의",
  payment: "지급 품의",
  project: "프로젝트 품의",
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  in_progress: "진행중",
  approved: "승인",
  rejected: "반려",
  canceled: "취소",
};

/** 사후보고 문서(approval_kind='report', 38번)의 상태 표기 — 승인/반려가 아니라 확인/피드백 */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  in_progress: "확인 대기",
  approved: "확인 완료",
  rejected: "피드백",
  canceled: "취소",
};

export function approvalStatusLabel(status: string, kind: string | null | undefined): string {
  const table = kind === "report" ? REPORT_STATUS_LABELS : APPROVAL_STATUS_LABELS;
  return table[status] ?? status;
}

export const STEP_KIND_LABELS: Record<string, string> = {
  approval: "결재",
  agreement: "합의",
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

/** 금액 표시 (원) */
export function formatKrw(amount: number | null): string {
  if (amount === null) return "-";
  return `${amount.toLocaleString("ko-KR")}원`;
}
