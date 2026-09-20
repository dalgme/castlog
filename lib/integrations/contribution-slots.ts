/**
 * 참여율 배분 가로 표의 열 (기획 지시 2026-09-21).
 *
 * 열 순서는 고정 — 대표이사 · 상무이사 · PL · PM · 부PM · 담당 · 빈칸 2개.
 * 빈칸 열은 회사가 머리글을 직접 적는다(예: 회계, 디자인). 사람은 열마다 한 명이고
 * 같은 사람이 두 열에 설 수 있다(대표가 PL을 겸임하는 회사). 저장은
 * project_contributions(slot_key, role_label, user_id, percentage) 한 행 = 한 열.
 * 클라이언트·서버 공용 — 서버 전용 import 금지.
 */

export const CONTRIBUTION_SLOT_KEYS = [
  "ceo",
  "director",
  "pl",
  "pm",
  "deputy_pm",
  "member",
  "extra1",
  "extra2",
] as const;

export type ContributionSlotKey = (typeof CONTRIBUTION_SLOT_KEYS)[number];

export const CONTRIBUTION_SLOT_LABELS: Record<ContributionSlotKey, string> = {
  ceo: "대표이사",
  director: "상무이사",
  pl: "PL",
  pm: "PM",
  deputy_pm: "부PM",
  member: "담당",
  extra1: "",
  extra2: "",
};

/** 머리글을 회사가 적는 열 */
export function isExtraSlot(key: ContributionSlotKey): boolean {
  return key === "extra1" || key === "extra2";
}

export function isContributionSlotKey(value: string | null | undefined): value is ContributionSlotKey {
  return (CONTRIBUTION_SLOT_KEYS as readonly string[]).includes(value ?? "");
}

/** 한 열의 저장·표시 단위 */
export type ContributionSlotRow = {
  slotKey: ContributionSlotKey;
  /** 빈칸 열의 머리글 (고정 열은 null) */
  roleLabel: string | null;
  /** 열에 선 사람 — 사람이 없는 열은 저장하지 않는다 */
  userId: string;
  percentage: number;
};
