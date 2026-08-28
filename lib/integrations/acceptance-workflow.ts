/**
 * 수락서 진행 상태 (Phase A-3) — 클라이언트·서버 공용 상수(server-only 아님).
 *  issued    수락 시 자동 생성됨 (기업이 보완 편집 가능)
 *  sent      기업이 전문가에게 송부 — 전문가 확인 대기
 *  signed    (과거 데이터 전용) 전문가 서명 완료 — 현재 흐름에서는 전문가
 *            승인(서명)이 곧바로 confirmed가 된다 (검수 A4: 1단계 확정 모델)
 *  confirmed 확정 — 전문가 승인(서명) 또는 라이트 모드의 기업 담당자 확인
 */
export const ACCEPTANCE_STATUS_LABELS: Record<string, string> = {
  issued: "작성중",
  sent: "송부됨",
  signed: "서명 완료",
  confirmed: "확정",
};

export const ACCEPTANCE_STATUS_TONE: Record<
  string,
  "gray" | "blue" | "amber" | "green"
> = {
  issued: "gray",
  sent: "amber",
  signed: "blue",
  confirmed: "green",
};

export function acceptanceStatusLabel(status: string): string {
  return ACCEPTANCE_STATUS_LABELS[status] ?? status;
}
