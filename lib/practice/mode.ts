/**
 * 연습모드 공통 상수 — 클라이언트 컴포넌트에서도 쓰므로 server-only를 두지 않는다.
 *
 * 연습모드는 '같은 테넌트 안의 격리된 사본'이다. 직급(grade)·위임 스코프·모듈
 * 조합이 실제 설정 그대로 적용되므로, 대표가 정해 둔 권한 범위를 벗어난 기능은
 * 연습에서도 열리지 않는다.
 */

/** JWT app_metadata에 들어가는 키 — 판정 근거는 항상 여기(CLAUDE.md §3). */
export const PRACTICE_CLAIM = "practice" as const;

/** 연습 프로젝트 기본 이름 — 시드가 만드는 연습 프로젝트를 식별한다. */
export const PRACTICE_PROJECT_NAME = "연습용 창업교육 프로그램";

/** 연습모드에서 잠기는 기능. 연습으로 실제 사고가 나는 것들만 막는다. */
export const PRACTICE_BLOCKED = {
  /** 실제 문자·이메일 발송 (수신자가 가상이라도 요금·오발송 위험) */
  sending: "연습모드에서는 실제 문자·이메일이 발송되지 않습니다.",
  /** 주민등록번호 조회 — 연습용 키 위임 체계를 따로 만들지 않는다 (§5) */
  taxAccess:
    "연습모드에서는 주민등록번호 조회를 연습할 수 없습니다. 실제 지급 건에서만 동작합니다.",
  /** 데이터 반출 */
  backup: "연습모드에서는 데이터 반출을 실행할 수 없습니다.",
} as const;

export type PracticeBlockedKey = keyof typeof PRACTICE_BLOCKED;
