/**
 * 체크리스트 (기획 지시 2026-09-05 — 렛츠 양식 ver.20260703).
 *
 * 공통 기반 소속(모듈 게이트 없음). 표준시트(테넌트별, 임직원 누구나 수정)를
 * 프로젝트에 불러와 프로젝트별 체크리스트로 쓴다. 프로젝트별 편집은 그 프로젝트
 * 팀(PL·PM·부PM·담당)과 전사 열람 권한자(대표·이사·팀장)가 한다.
 */

export const CHECKLIST_KINDS = [
  "common",
  "typed",
  "kickoff",
  "deadline",
  "venue",
  "supplies",
] as const;

export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export function isChecklistKind(v: unknown): v is ChecklistKind {
  return typeof v === "string" && (CHECKLIST_KINDS as readonly string[]).includes(v);
}

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  common: "공통 체크리스트",
  typed: "유형별 체크리스트",
  kickoff: "착수보고회 체크리스트",
  deadline: "마감일 체크리스트",
  venue: "숙소 및 강의장 체크리스트",
  supplies: "준비물품 체크리스트",
};

export const CHECKLIST_KIND_DESCRIPTIONS: Record<ChecklistKind, string> = {
  common:
    "모든 프로젝트가 거치는 실행 목록. 프로젝트에 불러오면 D-Day 기준 권장 마감일이 자동 계산됩니다.",
  typed:
    "캠프·멘토링/컨설팅·데모데이·전시행사 등 유형별 항목. 프로젝트 체크리스트에 세부 카테고리 단위로 불러옵니다.",
  kickoff: "착수보고회에서 확인·결정할 사항.",
  deadline: "발주처와의 업무분장용 — 진행 내용별 마감일과 양측 특이사항.",
  venue: "숙소·강의장 답사(1차 D-25)·최종 점검(D-10) 항목.",
  supplies: "준비물품 수량·1차 확인(D-25)·최종 확인(D-2). 팀빌딩 등 별도 시트를 추가할 수 있습니다.",
};

/** 프로젝트별 체크리스트 항목의 열 — 종류마다 보이는 열과 라벨이 다르다 */
export type ChecklistField =
  | "phase"
  | "category"
  | "subcategory"
  | "title"
  | "offsetDays"
  | "quantity"
  | "assignee"
  | "autoDue"
  | "plannedDue"
  | "completedOn"
  | "note"
  | "check1"
  | "check2"
  | "decision"
  | "applicable";

export type ChecklistColumn = {
  key: ChecklistField;
  label: string;
  /** 표준시트(템플릿)에도 있는 열인가 — 아니면 프로젝트에서만 기입 */
  template?: boolean;
  width?: string;
};

const SCHEDULE_COLUMNS: ChecklistColumn[] = [
  { key: "phase", label: "시기", template: true, width: "w-16" },
  { key: "subcategory", label: "세부 분류", template: true, width: "w-24" },
  { key: "title", label: "업무 내용", template: true },
  { key: "assignee", label: "담당", width: "w-28" },
  { key: "offsetDays", label: "권장(D±)", template: true, width: "w-16" },
  { key: "autoDue", label: "마감일 자동", width: "w-24" },
  { key: "plannedDue", label: "마감일 계획", width: "w-32" },
  { key: "completedOn", label: "완료일", width: "w-32" },
  { key: "note", label: "참고사항", template: true },
];

export const CHECKLIST_COLUMNS: Record<ChecklistKind, ChecklistColumn[]> = {
  common: SCHEDULE_COLUMNS,
  typed: [
    { key: "phase", label: "시기", template: true, width: "w-16" },
    { key: "category", label: "구분", template: true, width: "w-24" },
    { key: "subcategory", label: "세부 분류", template: true, width: "w-24" },
    { key: "title", label: "업무 내용", template: true },
    { key: "assignee", label: "담당", width: "w-28" },
    { key: "offsetDays", label: "권장(D±)", template: true, width: "w-16" },
    { key: "autoDue", label: "마감일 자동", width: "w-24" },
    { key: "plannedDue", label: "마감일 계획", width: "w-32" },
    { key: "completedOn", label: "완료일", width: "w-32" },
    { key: "note", label: "참고사항", template: true },
  ],
  kickoff: [
    { key: "category", label: "사업 분류", template: true, width: "w-24" },
    { key: "title", label: "확인 내용", template: true },
    { key: "applicable", label: "해당사항", width: "w-24" },
    { key: "decision", label: "결정사항" },
    { key: "assignee", label: "담당", width: "w-28" },
    { key: "note", label: "참고사항", template: true },
  ],
  deadline: [
    { key: "title", label: "진행 내용", template: true },
    { key: "plannedDue", label: "마감일", width: "w-32" },
    { key: "completedOn", label: "완료일", width: "w-32" },
    { key: "assignee", label: "담당", width: "w-28" },
    { key: "note", label: "진행 내용(메모)", template: true },
    { key: "check1", label: "발주기관 특이사항" },
    { key: "check2", label: "운영기관 특이사항" },
  ],
  venue: [
    { key: "category", label: "구분", template: true, width: "w-20" },
    { key: "title", label: "항목", template: true },
    { key: "check1", label: "1차 확인 (D-25)", width: "w-24" },
    { key: "check2", label: "최종 확인 (D-10)", width: "w-24" },
    { key: "decision", label: "최종 점검 사항" },
    { key: "assignee", label: "담당", width: "w-28" },
    { key: "note", label: "비고", template: true },
  ],
  supplies: [
    { key: "category", label: "구분", template: true, width: "w-24" },
    { key: "title", label: "항목", template: true },
    { key: "quantity", label: "수량", template: true, width: "w-20" },
    { key: "check1", label: "1차 확인 (D-25)", width: "w-24" },
    { key: "check2", label: "최종 확인 (D-2)", width: "w-24" },
    { key: "decision", label: "최종 점검 사항" },
    { key: "assignee", label: "담당", width: "w-28" },
    { key: "note", label: "비고", template: true },
  ],
};

/** 프로젝트 탭에서 '사용하기'로 새 시트를 만드는 종류 (공통·유형별은 불러오기) */
export const USE_BUTTON_KINDS: ChecklistKind[] = ["kickoff", "deadline", "venue", "supplies"];

/**
 * 완료일 칸 배경 — 기획 지시 05:
 * 완료일 기입 = 흰색 / 당일·지남 = 검정 / 잔여 2~3일(1일 포함) = 붉은색 /
 * 4~7일 = 초록 / 8~14일 = 옐로우그린 / 그 외 = 없음.
 */
export type DueTone = "done" | "overdue" | "urgent" | "soon" | "ahead" | "none";

export function dueTone(
  plannedDue: string | null,
  completedOn: string | null,
  todayIso: string
): DueTone {
  if (completedOn) return "done";
  if (!plannedDue) return "none";
  const days = Math.round(
    (Date.parse(plannedDue) - Date.parse(todayIso)) / 86_400_000
  );
  if (Number.isNaN(days)) return "none";
  if (days <= 0) return "overdue";
  if (days <= 3) return "urgent";
  if (days <= 7) return "soon";
  if (days <= 14) return "ahead";
  return "none";
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  done: "bg-white",
  overdue: "bg-black text-white",
  urgent: "bg-red-500 text-white",
  soon: "bg-green-500 text-white",
  ahead: "bg-lime-300 text-black",
  none: "",
};

export const DUE_TONE_LABELS: Record<DueTone, string> = {
  done: "완료",
  overdue: "당일·지남",
  urgent: "잔여 1~3일",
  soon: "잔여 4~7일",
  ahead: "잔여 8~14일",
  none: "",
};

/** D-Day + 권장(D±) → 자동 마감일 (yyyy-mm-dd) */
export function autoDueDate(dday: string | null, offsetDays: number | null): string | null {
  if (!dday || offsetDays === null) return null;
  const t = Date.parse(dday);
  if (Number.isNaN(t)) return null;
  return new Date(t + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** 오늘(KST) yyyy-mm-dd */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 변경 로그 행 (표준시트·프로젝트 공용 표시용) */
export type ChecklistLogRow = {
  id: string;
  at: string;
  actorName: string | null;
  action: string;
  itemTitle: string | null;
  field: string | null;
  before: string | null;
  after: string | null;
};

export const CHECKLIST_LOG_ACTION_LABELS: Record<string, string> = {
  "template.create": "시트 생성",
  "template.rename": "시트 이름 변경",
  "template.delete": "시트 삭제",
  "checklist.create": "체크리스트 생성",
  "checklist.delete": "체크리스트 삭제",
  "item.add": "항목 추가",
  "item.update": "항목 수정",
  "item.delete": "항목 삭제",
  "item.reorder": "순서 변경",
  "item.move": "분류 이동",
  "group.rename": "분류 이름 변경",
  "item.import": "항목 불러오기",
  "due.change": "마감일 변경(사유)",
  "due.reason_update": "변경 사유 수정",
  "dday.update": "D-Day 변경",
};
