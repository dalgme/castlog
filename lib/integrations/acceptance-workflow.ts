/**
 * 수락서 진행 상태 (Phase A-3) — 클라이언트·서버 공용 상수(server-only 아님).
 *  issued    수락 시 자동 생성됨 (기업이 보완 편집 가능)
 *  sent      기업이 전문가에게 송부 — 전문가 확인 대기
 *  signed    전문가가 확인·전자서명 완료 — 기업 확인 대기
 *  confirmed 기업담당자 최종 확인 (완료)
 */
export const ACCEPTANCE_STATUS_LABELS: Record<string, string> = {
  issued: "작성중",
  sent: "송부됨",
  signed: "서명 완료",
  confirmed: "확인 완료",
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
