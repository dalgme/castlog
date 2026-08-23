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

/**
 * 21스텝 자동 판정 (기획 확정 2026-08-23).
 * 시스템 데이터로 진행을 알 수 있는 스텝은 화면에서 자동 반영하고,
 * 나머지는 PL이 클릭으로 직접 선택한다. 여기 없는 stepNo = 수동.
 * 자동 판정은 표시 전용이다 — DB의 수동 값 위에 덮어 그린다.
 */
export type AutoStepContext = {
  /** projects.engagement_stage (섭외 진행 단계) */
  stage: string;
  hasBudget: boolean;
  closed: boolean;
};

const STAGE_ORDER = [
  "assigning",
  "plan_review",
  "plan_approved",
  "requesting",
  "accepted_all",
  "letters_sent",
  "confirmed",
  "closing",
  "settlement_review",
  "settled",
] as const;

function stageAtLeastLocal(stage: string, min: string): boolean {
  const a = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const b = STAGE_ORDER.indexOf(min as (typeof STAGE_ORDER)[number]);
  return a >= 0 && b >= 0 && a >= b;
}

/** 자동 판정 상태 — null이면 수동 스텝 */
export function autoStepStatus(
  stepNo: number,
  ctx: AutoStepContext
): StepStatus | null {
  const s = ctx.stage;
  switch (stepNo) {
    case 3: // 예산 편성
      return ctx.hasBudget ? "completed" : "pending";
    case 8: // 전문가 섭외 요청
      if (stageAtLeastLocal(s, "requesting")) return "completed";
      if (stageAtLeastLocal(s, "plan_review")) return "in_progress";
      return "pending";
    case 9: // 전문가 배정 확정
      if (stageAtLeastLocal(s, "confirmed")) return "completed";
      if (stageAtLeastLocal(s, "requesting")) return "in_progress";
      return "pending";
    case 10: // 일정 계획 확정
      if (stageAtLeastLocal(s, "plan_approved")) return "completed";
      if (stageAtLeastLocal(s, "plan_review")) return "in_progress";
      return "pending";
    case 15: // 만족도 조사
      if (stageAtLeastLocal(s, "settlement_review")) return "completed";
      if (stageAtLeastLocal(s, "closing")) return "in_progress";
      return "pending";
    case 16: // 전문가 비용 정산
      if (stageAtLeastLocal(s, "settled")) return "completed";
      if (stageAtLeastLocal(s, "settlement_review")) return "in_progress";
      return "pending";
    case 21: // 사업 종료·아카이브
      return ctx.closed ? "completed" : "pending";
    default:
      return null;
  }
}

/** 상태 박스 색 — 프로세스명 앞 컬러 박스 (기획 확정 2026-08-23) */
export const STEP_STATUS_BOX_CLASS: Record<StepStatus, string> = {
  pending: "bg-gray-300",
  in_progress: "bg-sky-500",
  completed: "bg-emerald-500",
  skipped: "border border-gray-300 bg-gray-100",
};
