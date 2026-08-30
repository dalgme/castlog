import type { Json } from "@/lib/supabase/database.types";

/**
 * 기업별 추가 기능 스위치 (기획 확정 2026-08-30 — 17번).
 *
 * 모듈(experts/approvals/operations)과 별개로, 특정 회사에만 열어 주는
 * **예외 기능**들의 레지스트리다. 기본값은 전부 꺼짐 — 켜는 것은 캐스트로그
 * 관리모드(기업별 기능 추가)에서만 한다. 저장은 tenants.feature_flags.
 * extra_features.{key} (boolean).
 *
 * 새 예외 기능은 여기 한 줄 추가 + 노출 지점 게이트 + 서버 액션 게이트 —
 * 관리모드 화면은 이 표를 순회하므로 자동으로 따라온다.
 */
export const TENANT_EXTRA_FEATURES = {
  direct_engagement: {
    label: "코드 없이 바로 섭외 (예외)",
    description:
      "코드넘버·섭외계획 품의 절차를 거치지 않고 전문가에게 곧바로 섭외 요청을 보내는 예외 경로입니다. 프로젝트 화면·전문가 목록의 '섭외 요청' 버튼이 열립니다. 이 경로의 건은 미연결 섭외로 기록되며, 정식 절차(후보 등록 → 품의 → 발송)를 우회하므로 필요한 회사에만 켜 주세요.",
  },
} as const satisfies Record<string, { label: string; description: string }>;

export type TenantExtraFeature = keyof typeof TENANT_EXTRA_FEATURES;

export const TENANT_EXTRA_FEATURE_KEYS = Object.keys(
  TENANT_EXTRA_FEATURES
) as TenantExtraFeature[];

/** feature_flags에서 추가 기능 상태를 읽는다 — 부재·형식 오류는 전부 꺼짐 (§14-10) */
export function parseExtraFeatures(
  featureFlags: Json | null | undefined
): Record<TenantExtraFeature, boolean> {
  const result = Object.fromEntries(
    TENANT_EXTRA_FEATURE_KEYS.map((k) => [k, false])
  ) as Record<TenantExtraFeature, boolean>;
  if (
    featureFlags === null ||
    featureFlags === undefined ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return result;
  }
  const raw = (featureFlags as Record<string, Json | undefined>).extra_features;
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return result;
  }
  for (const key of TENANT_EXTRA_FEATURE_KEYS) {
    if ((raw as Record<string, Json | undefined>)[key] === true) {
      result[key] = true;
    }
  }
  return result;
}
