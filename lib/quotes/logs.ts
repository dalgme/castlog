/**
 * 견적·내부실견적·정산 로그 표시 — 클라이언트도 쓰는 상수·타입이라
 * server-only 모듈과 분리해 둔다 (다이얼로그가 import한다).
 */

export type QuoteDocType = "quote" | "internal" | "settlement";

export const QUOTE_DOC_LABELS: Record<QuoteDocType, string> = {
  quote: "견적서",
  internal: "내부실견적서",
  settlement: "정산서",
};

export const QUOTE_LOG_ACTION_LABELS: Record<string, string> = {
  "doc.create": "문서 생성",
  "doc.update": "내용 수정",
  "doc.issue": "발행(확정)",
  "doc.new_version": "새 버전 작성",
  "doc.submit": "결재 상신",
  "doc.approve": "결재 승인",
  "doc.reject": "결재 반려",
  "doc.edit_grant": "수정 허용",
  "doc.resync": "원본 갱신 반영",
  "doc.delete": "문서 삭제",
  "item.add": "항목 추가",
  "item.update": "항목 수정",
  "item.delete": "항목 삭제",
  "item.reorder": "순서 변경",
};

export type QuoteLogRow = {
  id: string;
  at: string;
  actorName: string | null;
  docType: QuoteDocType;
  version: number | null;
  action: string;
  itemTitle: string | null;
  field: string | null;
  before: string | null;
  after: string | null;
};
