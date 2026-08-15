/**
 * 주민등록번호 조회 권한·한도 로직 (설계: rrn-phase2-secure-subsystem.md §7~9)
 *
 * 순수 상수·판정 함수만 제공한다(복호화 능력 아님). 실제 복호화는 분리 서비스(2.3).
 * 조회 지정자(회계담당·대표)만 조회 주체가 되며, 프로젝트당 2회 한도·시간당 상한이
 * 적용된다. 주민번호 조회 권한은 **대결·위임 대상에서 제외**한다(코드로 강제).
 */

/** 조회 지정자 역할 라벨 (tax_access_grants.role_label) */
export const RRN_ACCESS_ROLES = {
  accountant: "회계담당자",
  representative: "대표자",
} as const;
export type RrnAccessRole = keyof typeof RRN_ACCESS_ROLES;

/** 프로젝트당 기본 조회 한도 (초과는 차단이 아니라 사유+대표승인+통지) */
export const RRN_PROJECT_LIMIT = 2;

/** 시간당 복호화 상한 (사용자·테넌트별) — 초과 시 자동 잠금 */
export const RRN_RATE_LIMIT_PER_HOUR = 10;

/** 조회 사유 (tax_access_requests.reason) */
export const RRN_ACCESS_REASONS = {
  payment_approval: "지급품의",
  tax_filing: "세무자료 제출",
} as const;
export type RrnAccessReason = keyof typeof RRN_ACCESS_REASONS;

/**
 * 주민번호 조회 권한은 대결·위임(approval_delegations)에 포함되지 않는다.
 * 대결·위임 로직에서 이 상수로 조회 권한 이전을 차단한다.
 */
export const RRN_ACCESS_EXCLUDED_FROM_DELEGATION = true as const;

/** 남은 프로젝트 조회 한도 (음수 없음) */
export function remainingProjectQuota(usedCount: number): number {
  return Math.max(0, RRN_PROJECT_LIMIT - usedCount);
}

/** 프로젝트 조회 한도 초과 여부 (초과 시 사유 기재 + 대표 승인 필요) */
export function isOverProjectLimit(usedCount: number): boolean {
  return usedCount >= RRN_PROJECT_LIMIT;
}

/** 시간당 상한 초과(자동 잠금 대상) 여부 */
export function isRateLimited(countInWindow: number): boolean {
  return countInWindow >= RRN_RATE_LIMIT_PER_HOUR;
}
