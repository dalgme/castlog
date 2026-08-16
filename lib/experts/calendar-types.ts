/** 활동 캘린더 공용 타입 (클라이언트·서버 공용). */

export type CalendarSource = "external" | "castlog";

export type CalendarEvent = {
  id: string;
  source: CalendarSource;
  title: string;
  orgName: string | null;
  location: string | null;
  /** ISO 문자열 (all_day면 날짜 기준) */
  start: string;
  end: string | null;
  allDay: boolean;
  memo: string | null;
  /** 외부 일정: 연결 기업의 가용성 확인에 공유되는지 여부 */
  shared: boolean;
};
