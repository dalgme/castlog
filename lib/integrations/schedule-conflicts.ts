/**
 * 전문가 일정 중복 판독 결과의 공통 모델.
 *
 * 타사 섭외·전문가 개인 일정은 §4(테넌트 격리)에 따라 기관·프로젝트·비용 등
 * 상세를 절대 노출하지 않는다. 다만 "겹치는 게 몇 건 있다"만 알려주면
 * 섭외 담당자가 판단을 못 한다 — 아직 수락 전인 '섭외 진행 중'과 이미 확정된
 * 건은 의미가 전혀 다르기 때문이다(전자는 경합, 후자는 사실상 불가).
 * 그래서 **상태별 건수까지만** 구분해 알려준다. 상세는 여전히 비공개.
 *
 * 클라이언트 컴포넌트에서도 문구를 만들어야 하므로 server-only를 두지 않는다.
 */
export type BlindConflicts = {
  /** 타사가 요청했지만 전문가가 아직 수락하지 않은 섭외 — 경합 상태 */
  requested: number;
  /** 타사에서 이미 수락·확정된 섭외 */
  accepted: number;
  /** 전문가 본인이 등록한 개인 일정(공유 허용분) */
  personal: number;
};

export function emptyBlindConflicts(): BlindConflicts {
  return { requested: 0, accepted: 0, personal: 0 };
}

export function blindConflictTotal(b: BlindConflicts): number {
  return b.requested + b.accepted + b.personal;
}

/**
 * 후보 정렬용 가중치. 확정 섭외·개인 일정은 사실상 불가(2점),
 * 아직 수락 전인 섭외요청은 경합일 뿐이므로 더 가볍게(1점) 본다.
 */
export function blindConflictWeight(b: BlindConflicts): number {
  return b.requested * 1 + b.accepted * 2 + b.personal * 2;
}

/** 화면에 그대로 쓰는 안내 문구. 건수가 0인 항목은 만들지 않는다. */
export function describeBlindConflicts(b: BlindConflicts): string[] {
  const lines: string[] = [];
  if (b.requested > 0) {
    lines.push(
      `해당 일정과 중복되어 섭외 진행 중 ${b.requested}건 (타사 요청 · 아직 미수락)`
    );
  }
  if (b.accepted > 0) {
    lines.push(`해당 일정에 이미 확정된 섭외 ${b.accepted}건 (타사)`);
  }
  if (b.personal > 0) {
    lines.push(`전문가 본인이 등록한 일정 ${b.personal}건`);
  }
  return lines;
}

/** 섭외 상태를 blind 버킷 키로. 판독 대상 외 상태는 null. */
export function blindBucketOf(status: string): "requested" | "accepted" | null {
  if (status === "requested") return "requested";
  if (status === "accepted") return "accepted";
  return null;
}
