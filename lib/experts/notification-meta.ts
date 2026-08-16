/**
 * 알림 표시 메타 (클라이언트·서버 공용 — server-only 아님).
 * 아이콘은 문자열 키로 두고 클라이언트에서 lucide 아이콘에 매핑한다.
 */
export type NotificationCategory =
  | "engagement_request"
  | "engagement_cancelled"
  | "document_request"
  | "rrn_access"
  | "external_send_opened"
  | "system";

export const NOTIFICATION_META: Record<
  NotificationCategory,
  { label: string; icon: string; tone: "blue" | "amber" | "green" | "red" | "gray" }
> = {
  engagement_request: { label: "섭외 요청", icon: "inbox", tone: "blue" },
  engagement_cancelled: { label: "섭외 취소", icon: "x-circle", tone: "red" },
  document_request: { label: "서류 요청", icon: "file-text", tone: "amber" },
  rrn_access: { label: "주민번호 조회", icon: "shield-alert", tone: "red" },
  external_send_opened: { label: "외부 발송 열람", icon: "mail-open", tone: "green" },
  system: { label: "안내", icon: "bell", tone: "gray" },
};

export function notificationMeta(category: string) {
  return (
    NOTIFICATION_META[category as NotificationCategory] ?? NOTIFICATION_META.system
  );
}
