/**
 * 테넌트 슬러그 예약어 (설계문서 5.2)
 *
 * - a~z 단일 문자 26개 전부: 공개 짧은 경로용으로 영구 예약.
 *   인쇄된 QR·발송된 문자는 회수가 불가능하므로, 향후 새 공개 경로가
 *   필요할 때 즉시 쓸 수 있도록 미리 전부 막아둔다.
 * - 새 공개 경로를 추가할 때는 이 파일의 PUBLIC_LINK_PATHS도 함께 갱신할 것.
 */

/** 단일 문자 a~z — 전부 예약 */
export const SINGLE_LETTER_SLUGS: readonly string[] = Array.from(
  { length: 26 },
  (_, i) => String.fromCharCode(97 + i)
);

/** 시스템 예약어 */
export const SYSTEM_RESERVED_SLUGS: readonly string[] = [
  "expert",
  "admin",
  "platform-admin",
  "api",
  "login",
  "logout",
  "signup",
  "static",
  "assets",
  "public",
  "help",
  "support",
  "about",
  "contact",
  "dashboard",
  "settings",
  "auth",
  "_next",
];

/** 전체 예약어 집합 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  ...SINGLE_LETTER_SLUGS,
  ...SYSTEM_RESERVED_SLUGS,
]);

/**
 * Phase 1에서 실제 사용하는 공개 짧은 경로.
 * Phase 2+ 예정: /s 설문 · /r 모집신청 · /g 방명록 · /c 위촉장 · /i 행사안내
 *               /m 멘토링 · /f 자료 · /v 수료증 · /a 출석
 */
export const PUBLIC_LINK_PATHS = {
  engagementConsent: "e", // 섭외 동의 (매직링크)
  expertJoin: "j", // 전문가 등록 요청 (신규)
  documentSubmit: "d", // 서류 제출·갱신 (기존 전문가)
  unsubscribe: "u", // 수신거부 — 광고성 발송 시 법적 필수
} as const;

export type PublicLinkKind = keyof typeof PUBLIC_LINK_PATHS;
