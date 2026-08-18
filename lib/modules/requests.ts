import { MODULE_KEYS, type ModuleFlags, type ModuleKey } from "./modules";

/**
 * 모듈 추가 요청 공통 타입·파서 — 클라이언트 컴포넌트에서도 쓰므로
 * server-only를 두지 않는다.
 */

export type ModuleRequestStatus = "pending" | "approved" | "rejected" | "canceled";

export const MODULE_REQUEST_STATUS_LABELS: Record<ModuleRequestStatus, string> = {
  pending: "검토 대기",
  approved: "승인",
  rejected: "거절",
  canceled: "요청 취소",
};

export type ModuleRequest = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  /** 켜 달라고 요청한 모듈만 */
  requested: ModuleKey[];
  /** 요청 시점에 이미 켜져 있던 모듈 */
  current: ModuleKey[];
  note: string | null;
  status: ModuleRequestStatus;
  requesterName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export function isModuleRequestStatus(v: string): v is ModuleRequestStatus {
  return ["pending", "approved", "rejected", "canceled"].includes(v);
}

/**
 * requested_modules(JSONB) → 켜 달라고 요청한 모듈 키 배열.
 * true인 것만 취한다 — 끄는 요청은 받지 않는다(끄는 건 계약 해지 협의 사항).
 */
export function parseRequestedModules(value: unknown): ModuleKey[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const out: ModuleKey[] = [];
  for (const key of MODULE_KEYS) {
    if ((value as Record<string, unknown>)[key] === true) out.push(key);
  }
  return out;
}

/** 요청 대상으로 고를 수 있는 모듈 = 아직 안 켜진 것. */
export function requestableModules(current: ModuleFlags): ModuleKey[] {
  return MODULE_KEYS.filter((key) => !current[key]);
}
