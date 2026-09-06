import type { ChecklistKind } from "./kinds";

/** 표준시트 화면 모델 — 설정 페이지와 프로젝트 탭 팝업이 같은 모양을 쓴다 */
export type TemplateItemView = {
  id: string;
  phase: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  offsetDays: number | null;
  quantity: string | null;
  note: string | null;
};

export type TemplateView = {
  id: string;
  kind: ChecklistKind;
  name: string;
  updatedAt: string;
  /** 마지막으로 시트를 고친 임직원 — 회사 공용 시트라 표시한다 */
  updatedByName: string | null;
  items: TemplateItemView[];
};
