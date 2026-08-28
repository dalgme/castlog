/**
 * 세션 안내문자 치환 변수·기본 문구 (클라이언트 공용).
 * 발송 로직은 lib/integrations/session-notices.ts (server-only)에 있다.
 */

export const NOTICE_VARIABLES = [
  { key: "{전문가명}", desc: "수신 전문가 이름" },
  { key: "{기업명}", desc: "발송 기업(자사) 이름" },
  { key: "{사업명}", desc: "프로젝트명" },
  { key: "{세션명}", desc: "타임테이블의 세션명" },
  { key: "{일정}", desc: "날짜와 시간 구간" },
  { key: "{일자}", desc: "날짜만" },
  { key: "{시간}", desc: "시간 구간만" },
  { key: "{장소}", desc: "장소명 (주소 포함)" },
  { key: "{역할}", desc: "역할 구분" },
  { key: "{코드}", desc: "코드넘버" },
] as const;

export const DEFAULT_NOTICE_BODY =
  `[{기업명}] {사업명} 안내\n` +
  `{전문가명} 님, {세션명} 일정을 안내드립니다.\n` +
  `· 일정: {일정}\n` +
  `· 장소: {장소}\n` +
  `· 역할: {역할}\n` +
  `문의사항은 회신 부탁드립니다.`;
