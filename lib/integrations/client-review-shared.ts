/**
 * 발주처 검토 — 서버·클라이언트 공용 상수·타입 (기획 승인 2026-11-07 — 3단계).
 */

export const CLIENT_OPINIONS = ["ok", "replace", "hold"] as const;
export type ClientOpinion = (typeof CLIENT_OPINIONS)[number];
export const CLIENT_OPINION_LABELS: Record<ClientOpinion, string> = {
  ok: "적합",
  replace: "교체 요청",
  hold: "보류",
};
export function isClientOpinion(v: unknown): v is ClientOpinion {
  return typeof v === "string" && (CLIENT_OPINIONS as readonly string[]).includes(v);
}

/** 발주처 링크 기본 유효기간(일) */
export const CLIENT_LINK_DEFAULT_DAYS = 14;
export const CLIENT_LINK_MAX_DAYS = 60;
/** 비밀번호 틀림 허용 횟수 · 잠금 시간(분) */
export const CLIENT_LINK_MAX_FAILS = 5;
export const CLIENT_LINK_LOCK_MINUTES = 15;

/** 발주처가 보는 후보 카드 — 연락처·단가·이력서는 없다 (설계안 §6-2) */
export type ClientDocCandidate = {
  entryId: string;
  rank: number;
  code: string;
  name: string;
  specialty: string | null;
  organization: string | null;
  jobTitle: string | null;
  careerYears: number | null;
  region: string | null;
  expertise: string[];
};

export type ClientDocSlot = {
  slotId: string;
  sessionLabel: string;
  roleLabel: string | null;
  candidates: ClientDocCandidate[];
};

export type ClientDoc = {
  listId: string;
  revision: number;
  projectName: string;
  tenantName: string | null;
  clientName: string | null;
  slots: ClientDocSlot[];
};

export type ClientLinkView = {
  id: string;
  round: number;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  /** 살아 있음 = 미회수·미만료 */
  live: boolean;
};

export type ClientResponseView = {
  id: string;
  round: number;
  respondentName: string | null;
  generalComment: string | null;
  submittedAt: string;
  items: { entryId: string; opinion: ClientOpinion; comment: string | null }[];
};

export type ClientReviewTabData = {
  ready: boolean;
  /** 발주처 검토 대상 리스트 (내부 검토 완료 이후 상태) — 없으면 null */
  list: { id: string; revision: number; status: string; title: string; internalDoneAt: string | null } | null;
  doc: ClientDoc | null;
  links: ClientLinkView[];
  responses: ClientResponseView[];
};
