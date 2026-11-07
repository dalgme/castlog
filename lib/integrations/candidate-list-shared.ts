/**
 * 섭외 후보 리스트 — 서버·클라이언트 공용 상수와 타입 (기획 승인 2026-11-07 — 2단계).
 * 조회·저장 로직은 lib/integrations/candidate-lists.ts(server-only)에 있다.
 */

export const MIN_MEMOS_PER_CANDIDATE = 3;

export const CANDIDATE_LIST_STATUS_LABELS: Record<string, string> = {
  internal_requested: "내부 검토 중",
  internal_done: "내부 검토 완료",
  client_sent: "발주처 검토 중",
  client_replied: "발주처 회신 받음",
  adjusting: "후보 조정 중",
  submitted: "품의 상신됨",
  superseded: "다시 작성으로 대체",
};

export type CandidateDraftEntry = {
  slotId: string;
  positionId: string;
  expertId: string;
  expertName: string;
  rank: number;
  code: string;
  sessionLabel: string;
  roleLabel: string | null;
  unitFeeOnline: number | null;
  unitFeeOffline: number | null;
  totalFeeMin: number | null;
  totalFeeMax: number | null;
  feeText: string | null;
  /** 이 프로젝트에서 남긴 자격메모 (최신순) */
  memos: { id: string; body: string; authorName: string | null; createdAt: string }[];
};

export type CandidateDraftSlot = {
  slotId: string;
  sessionLabel: string;
  sessionName: string | null;
  roleLabel: string | null;
  requiredCount: number;
  entries: CandidateDraftEntry[];
};

export type CandidateDraft = {
  slots: CandidateDraftSlot[];
  /** 후보(전문가) 수 */
  candidateCount: number;
  /** 자격메모가 3개 미만인 후보 */
  shortOnMemos: { expertId: string; expertName: string; count: number }[];
};

export type CandidateListView = {
  id: string;
  revision: number;
  status: string;
  title: string;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  internalRequestedAt: string | null;
  internalDoneAt: string | null;
  entries: {
    id: string;
    slotId: string | null;
    positionId: string | null;
    expertId: string;
    expertName: string;
    rank: number;
    code: string;
    sessionLabel: string;
    roleLabel: string | null;
    feeText: string | null;
    memoCount: number;
  }[];
  reviews: { id: string; reviewerUserId: string; reviewerName: string; status: string; requestedAt: string; doneAt: string | null }[];
  comments: { id: string; entryId: string | null; authorUserId: string; authorName: string; body: string; createdAt: string }[];
};

export type ReviewerOption = { id: string; name: string; grade: string | null; positionName: string | null };

export type CandidateListTabData = {
  ready: boolean;
  draft: CandidateDraft;
  /** 살아 있는 리스트(내부 검토 중/완료/발주처 단계…) — 없으면 null */
  list: CandidateListView | null;
  /** 과거 리비전(대체·상신됨) 요약 */
  history: { id: string; revision: number; status: string; createdAt: string }[];
  reviewerOptions: ReviewerOption[];
};
