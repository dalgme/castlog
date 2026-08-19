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

/**
 * 조회 지정자 인원 상한 (활성 기준).
 *
 * 실무에서 필요한 자리는 대표·임원(전결)·회계담당 정도다. 그 이상은
 * "혹시 몰라서"로 늘어나고, 조회 가능한 사람이 늘어난 만큼 유출면이 넓어진다.
 * 부족하면 늘리는 게 아니라 교체한다. DB 트리거(app.enforce_tax_grant_limit)로도
 * 강제하므로 앱을 우회한 경로에서도 지켜진다.
 */
export const RRN_GRANT_LIMIT = 3;

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

/** 조회 형태 (tax_access_logs.access_type) */
export const RRN_ACCESS_TYPES = {
  file_generation: "지급명세서 파일 생성",
  screen: "화면 조회(예외)",
} as const;

/** 초과 조회 요청 상태 (tax_access_requests.status) */
export const RRN_REQUEST_STATUS = {
  pending: "대표 승인 대기",
  approved: "승인됨(미사용)",
  denied: "반려됨",
  fulfilled: "승인 후 조회 완료",
} as const;
export type RrnRequestStatus = keyof typeof RRN_REQUEST_STATUS;

export function rrnRequestStatusLabel(status: string): string {
  return status in RRN_REQUEST_STATUS
    ? RRN_REQUEST_STATUS[status as RrnRequestStatus]
    : status;
}

export function rrnAccessTypeLabel(accessType: string): string {
  return accessType in RRN_ACCESS_TYPES
    ? RRN_ACCESS_TYPES[accessType as keyof typeof RRN_ACCESS_TYPES]
    : accessType;
}

export function rrnAccessReasonLabel(reason: string): string {
  return reason in RRN_ACCESS_REASONS
    ? RRN_ACCESS_REASONS[reason as RrnAccessReason]
    : reason;
}
