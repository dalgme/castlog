/**
 * 프로젝트 이메일 대장 — 공용 상수·타입 (기획 지시 2026-11-08).
 * PL이 "이 프로젝트의 담당자들이 보낸 모든 메일"의 발송 내용·수신 여부를 확인하는 자리.
 */

export const MAIL_PURPOSE_LABELS: Record<string, string> = {
  engagement_request: "섭외 요청",
  engagement_bundle: "섭외 요청(묶음)",
  acceptance_letter: "수락서 송부",
  acceptance_reminder: "수락서 재안내",
  direct_engagement: "섭외 요청(코드 없이)",
  general: "기타",
};

/** 발송 상태(우리 쪽) — email_logs.status */
export const MAIL_SEND_STATUS_LABELS: Record<string, string> = {
  sent: "발송됨",
  failed: "발송 실패",
  blocked: "차단",
  test: "테스트 모드 — 실발송 안 됨",
};

/** 수신 상태(공급자 웹훅) — email_logs.delivery_status */
export const MAIL_DELIVERY_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  queued: { label: "공급자 접수 — 전달 확인 전", tone: "muted" },
  delayed: { label: "전달 지연", tone: "warn" },
  delivered: { label: "수신 서버 전달됨", tone: "ok" },
  opened: { label: "열람 확인", tone: "ok" },
  bounced: { label: "반송(주소 오류 등)", tone: "bad" },
  complained: { label: "스팸 신고", tone: "bad" },
  failed: { label: "전달 실패", tone: "bad" },
};

export type MailLedgerRow = {
  id: string;
  createdAt: string;
  senderName: string | null;
  recipientEmail: string;
  recipientName: string | null;
  purpose: string;
  subject: string;
  body: string;
  bodyHtml: string | null;
  sendStatus: string;
  errorMessage: string | null;
  deliveryStatus: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  bouncedAt: string | null;
  deliveryDetail: string | null;
  engagementIds: string[];
  /** 수신 상태 추적 가능 여부 — 공급자 메시지 id가 있어야 웹훅이 매칭된다 */
  trackable: boolean;
};

export type MailLedgerData = {
  /** 0016 적용 여부 — 컬럼이 없으면 대장을 만들 수 없다 */
  ready: boolean;
  rows: MailLedgerRow[];
  /** 공급자 웹훅 설정 여부 — 없으면 수신 상태는 '확인 불가'로 안내 */
  webhookConfigured: boolean;
  providerConfigured: boolean;
};
