/**
 * 도입 문의·무료 체험 신청 처리 상태 (platform_inquiries.status).
 * 클라이언트 컴포넌트에서도 쓰므로 server-only 의존을 두지 않는다.
 */
export const INQUIRY_STATUSES = [
  "new",
  "contacted",
  "converted",
  "closed",
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "신규",
  contacted: "연락함",
  converted: "테넌트 생성됨",
  closed: "종료",
};

export const INQUIRY_STATUS_DESCRIPTIONS: Record<InquiryStatus, string> = {
  new: "아직 아무도 연락하지 않은 신청",
  contacted: "담당자가 연락해 상담을 진행 중",
  converted: "테넌트를 생성해 사용이 시작됨",
  closed: "도입하지 않기로 정리된 건",
};

export function isInquiryStatus(value: string): value is InquiryStatus {
  return (INQUIRY_STATUSES as readonly string[]).includes(value);
}
