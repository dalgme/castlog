/**
 * 전문가 등급 태그 (자사 기준 · 테넌트 격리).
 *
 * 즐겨찾기 / VIP / 주의 중 하나. 전문가 1명당 1개 — 즐겨찾기와 VIP를 동시에
 * 켜는 조합은 실무에서 의미가 없어 등급 하나로 단순화했다.
 *
 * ** 전문가 본인에게는 절대 노출하지 않는다 (CLAUDE.md §4). **
 * RLS에도 is_expert_self 경로가 없고, 전문가 포털 어떤 화면에서도 조회하지 않는다.
 *
 * 클라이언트 컴포넌트에서도 쓰므로 server-only를 붙이지 않는다.
 */

export const EXPERT_TAGS = ["favorite", "vip", "caution"] as const;
export type ExpertTag = (typeof EXPERT_TAGS)[number];

export const EXPERT_TAG_LABELS: Record<ExpertTag, string> = {
  favorite: "즐겨찾기",
  vip: "VIP",
  caution: "주의",
};

export const EXPERT_TAG_DESCRIPTIONS: Record<ExpertTag, string> = {
  favorite: "자주 섭외하는 전문가 — 후보군 상단에 노출됩니다.",
  vip: "핵심 전문가 — 우선 섭외 대상으로 관리합니다.",
  caution: "섭외 시 확인이 필요한 전문가 — 사유를 함께 남겨 주세요.",
};

/** 후보군 정렬 가중치 (작을수록 먼저). 태그 없음은 중간. */
export function tagSortWeight(tag: string | null): number {
  if (tag === "vip") return 0;
  if (tag === "favorite") return 1;
  if (tag === "caution") return 3;
  return 2;
}

export function isExpertTag(value: unknown): value is ExpertTag {
  return (
    typeof value === "string" && (EXPERT_TAGS as readonly string[]).includes(value)
  );
}

export function expertTagLabel(value: string | null | undefined): string | null {
  return isExpertTag(value) ? EXPERT_TAG_LABELS[value] : null;
}
