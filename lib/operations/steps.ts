/**
 * 21스텝 프로젝트 라이프사이클 기본 템플릿 (operations 모듈 — 설계문서 6장)
 *
 * project_lifecycle_steps는 오케스트레이션 전용이다 — 업무 데이터는
 * 각 단계의 전용 테이블(모집·섭외·정산 등)에 정규화 저장한다 (Hard NO 5).
 * 템플릿은 프로젝트 생성 시 복사되며, 이후 프로젝트별로 추가·삭제 가능.
 */

export type StepType =
  | "preparation"
  | "recruitment"
  | "operation"
  | "settlement"
  | "reporting";

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  preparation: "준비",
  recruitment: "모집",
  operation: "운영",
  settlement: "정산",
  reporting: "보고·종료",
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  in_progress: "진행중",
  completed: "완료",
  skipped: "해당없음",
};

export const STEP_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  planned: "계획",
  active: "진행중",
  on_hold: "보류",
  completed: "완료",
  cancelled: "취소",
};

/** 기본 21스텝 — 창업교육·컨설팅 프로젝트 표준 흐름 */
export const DEFAULT_LIFECYCLE_STEPS: readonly {
  stepNo: number;
  stepType: StepType;
  title: string;
}[] = [
  { stepNo: 1, stepType: "preparation", title: "사업 계약 체결" },
  { stepNo: 2, stepType: "preparation", title: "사업계획 수립" },
  { stepNo: 3, stepType: "preparation", title: "예산 편성" },
  { stepNo: 4, stepType: "preparation", title: "킥오프 미팅" },
  { stepNo: 5, stepType: "recruitment", title: "모집 공고 게시" },
  { stepNo: 6, stepType: "recruitment", title: "참가 신청 접수" },
  { stepNo: 7, stepType: "recruitment", title: "참가자 선정·통보" },
  { stepNo: 8, stepType: "recruitment", title: "전문가 섭외 요청" },
  { stepNo: 9, stepType: "recruitment", title: "전문가 배정 확정" },
  { stepNo: 10, stepType: "operation", title: "일정 계획 확정" },
  { stepNo: 11, stepType: "operation", title: "장소·행사 준비" },
  { stepNo: 12, stepType: "operation", title: "참가자 안내 발송" },
  { stepNo: 13, stepType: "operation", title: "프로그램 운영" },
  { stepNo: 14, stepType: "operation", title: "출석·참여 관리" },
  { stepNo: 15, stepType: "operation", title: "만족도 조사" },
  { stepNo: 16, stepType: "settlement", title: "전문가 비용 정산" },
  { stepNo: 17, stepType: "settlement", title: "사업비 집행 정리" },
  { stepNo: 18, stepType: "reporting", title: "결과 데이터 정리" },
  { stepNo: 19, stepType: "reporting", title: "결과보고서 작성" },
  { stepNo: 20, stepType: "reporting", title: "보고서 검수·제출" },
  { stepNo: 21, stepType: "reporting", title: "사업 종료·아카이브" },
];
