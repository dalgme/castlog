/**
 * 상담게시판 상수·타입 (클라이언트 공용).
 * 서버 액션 파일("use server")은 async 함수만 내보낼 수 있어 여기로 분리한다.
 */

export type FeedbackStatus =
  | "new"
  | "reviewing"
  | "planned"
  | "done"
  | "dismissed";

export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  "new",
  "reviewing",
  "planned",
  "done",
  "dismissed",
];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "새 건",
  reviewing: "검토 중",
  planned: "반영 예정",
  done: "반영 완료",
  dismissed: "보류",
};

export type BoardRow = {
  id: string;
  kind: "suggestion" | "bug" | "confusion";
  title: string;
  summary: string;
  path: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  tenantName: string | null;
  createdAt: string;
};

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as string[]).includes(value);
}
