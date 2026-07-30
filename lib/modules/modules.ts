import type { Json } from "@/lib/supabase/database.types";

/**
 * 기능 모듈 구조 (CLAUDE.md 1-2)
 *
 * 플랫폼 기능을 선택 사용 가능한 모듈 축으로 나눈다. 테넌트별 활성 여부는
 * tenants.feature_flags.modules 에 저장하며, 미설정 시 전부 활성(기존 호환).
 *
 *  - experts    전문가 섭외·관리 (풀·등록·서류·섭외·지급/세무)
 *  - approvals  품의·전자결재 (품의서·결재라인·전결규정·대결)
 *  - operations 프로젝트·행사 운영 (21스텝·일정·공개링크)
 *
 * insights(통계·AI 보고서)는 향후 분리 예정 키 — 지금은 공통 기반에 포함.
 */
export const MODULE_KEYS = ["experts", "approvals", "operations"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleFlags = Record<ModuleKey, boolean>;

/** 미설정 테넌트 기본값 — 전부 활성 */
export const DEFAULT_MODULES: ModuleFlags = {
  experts: true,
  approvals: true,
  operations: true,
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  experts: "전문가 섭외·관리",
  approvals: "품의·전자결재",
  operations: "프로젝트·행사 운영",
};

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** tenants.feature_flags(JSONB)에서 모듈 활성 여부를 파싱한다. 형식 오류는 기본값 처리. */
export function parseModuleFlags(featureFlags: Json | null | undefined): ModuleFlags {
  const result: ModuleFlags = { ...DEFAULT_MODULES };

  if (
    featureFlags === null ||
    featureFlags === undefined ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return result;
  }

  const modules = featureFlags["modules"];
  if (
    modules === null ||
    modules === undefined ||
    typeof modules !== "object" ||
    Array.isArray(modules)
  ) {
    return result;
  }

  for (const [key, value] of Object.entries(modules)) {
    if (isModuleKey(key) && typeof value === "boolean") {
      result[key] = value;
    }
  }

  return result;
}
