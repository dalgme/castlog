import type { Json } from "@/lib/supabase/database.types";

/**
 * 기능 모듈 구조 (CLAUDE.md 1-2)
 *
 * 플랫폼 기능을 선택 사용 가능한 모듈 축으로 나눈다. 테넌트별 활성 여부는
 * tenants.feature_flags.modules 에 저장하며, 미설정 시 전부 활성(기존 호환).
 *
 *  - experts    전문가 섭외·관리 (풀·등록·서류·섭외·평가·지급/세무)
 *  - approvals  품의·전자결재 (품의서·결재라인·전결규정·대결)
 *  - operations 행사 운영 심화 (21스텝 라이프사이클·공개링크·프로젝트 복제)
 *
 * insights(통계·AI 보고서)는 향후 분리 예정 키 — 지금은 공통 기반에 포함.
 *
 * ── 프로젝트 기초는 모듈이 아니라 '공통 기반'이다 (기획 확정) ──────────────
 * 어떤 모듈 조합을 쓰든 일은 프로젝트를 여는 데서 시작한다. 아래는 모듈과
 * 무관하게 항상 제공된다. operations를 끄면 21스텝·공개링크만 사라지고,
 * 프로젝트 자체는 그대로 쓴다.
 *   · 프로젝트 개설·기본정보 (행사명·발주처·사업연도·기간·예산·설명)
 *   · PM(1명)·부PM(제한 없음)·담당자 배정
 *   · 세션별 정보 (날짜·시간·세션명·역할·필요인원·1인당 비용·장소)
 *   · 전문가 코드넘버(넘버링코드) 자동 발급
 *   · 프로젝트 목록·대시보드·엑셀 내보내기
 *   · 종료 기여도 배분·상태 전환
 * 코드넘버까지가 공통이고, **그 자리에 실제 전문가를 붙이는 것**부터 experts다.
 */

/** 모듈과 무관하게 항상 제공되는 기능 — 안내 화면·모듈 선택 화면에서 함께 보여준다. */
export const COMMON_BASELINE_FEATURES: readonly string[] = [
  "프로젝트 개설·기본정보 (행사명·발주처·사업연도·기간·예산)",
  "PM·부PM·담당자 배정",
  "세션별 정보 등록 (일시·역할·필요인원·비용·장소)",
  "전문가 코드넘버 자동 발급",
  "프로젝트 목록·대시보드·엑셀 내보내기",
  "종료 기여도 배분",
  "계정·권한(6단계)·위임, 조직·직급 관리",
  "문자·이메일 발송 인프라, 수신거부 처리",
  "감사로그, 사용량 계측, 알림함",
];
export const MODULE_KEYS = ["experts", "approvals", "operations"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleFlags = Record<ModuleKey, boolean>;

/** 미설정 테넌트 기본값 — 전부 활성 */
export const DEFAULT_MODULES: ModuleFlags = {
  experts: true,
  approvals: true,
  operations: true,
};

/**
 * 모듈 번호 — 관리모드에서 한눈에 읽기 위한 짧은 식별자.
 *
 * 이름표(전문가 섭외/전자결재/행사 운영 심화)는 목록에서 줄을 잡아먹어 기업이
 * 열 곳만 되어도 표가 무너진다. 번호는 자리를 거의 쓰지 않으면서 조합을
 * 비교하게 해 준다 — '1·2'와 '1·2·3'의 차이가 즉시 보인다.
 * 순서는 MODULE_KEYS와 같다. 새 모듈은 뒤에 붙인다(기존 번호를 바꾸지 않는다).
 */
export const MODULE_NUMBERS: Record<ModuleKey, number> = {
  experts: 1,
  approvals: 2,
  operations: 3,
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  experts: "전문가 섭외·관리",
  approvals: "품의·전자결재",
  operations: "행사 운영 심화",
};

/** 모듈 선택 화면에서 '이걸 켜면 무엇이 열리는지' 보여주는 설명. */
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  experts:
    "전문가 풀·연결·서류 수집, 코드넘버 자리에 실제 전문가 섭외요청·수락서, 평가·등급, 지급·세무",
  approvals:
    "품의서·결재라인·전결규정·대결/위임. 섭외계획·프로젝트 종료·지급에 결재 게이트가 붙습니다",
  operations:
    "프로젝트 21스텝 라이프사이클 기본 구성. 공개링크(설문·모집 등)·프로젝트 복제·보고서는 순차 제공 예정",
};

/** 각 모듈을 켰을 때 기존 데이터와 이어야 할 것 — 후행 활성 안내에 쓴다. */
export const MODULE_ONBOARDING_HINTS: Record<ModuleKey, readonly string[]> = {
  experts: [
    "전문가를 초대해 자사와 연결하면 코드넘버 자리에 섭외요청을 보낼 수 있습니다.",
    "이미 만들어 둔 세션·코드넘버는 그대로 쓰입니다 — 다시 만들 필요가 없습니다.",
  ],
  approvals: [
    "전결규정을 먼저 등록하세요. 없으면 결재선을 매번 직접 지정해야 합니다.",
    "결재 없이 확정해 둔 지급 배치 중 대기 상태인 건은 지급 품의로 상신할 수 있습니다.",
    "이제 섭외요청 전에 섭외계획 품의 승인이 필요합니다.",
  ],
  operations: [
    "기존 프로젝트에는 21스텝이 없습니다. 프로젝트 상세의 '기본 스텝 만들기' 버튼으로 채울 수 있습니다.",
    "프로젝트에 연결하지 않고 만들어 둔 섭외 건이 있으면 프로젝트에 붙일 수 있습니다.",
  ],
};

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * 전문가 섭외 라이트 모드 (기획 확정 2026-08-25 — docs/decisions/experts-lite.md)
 *
 * experts 모듈의 '운영 방식' 옵션이다. 켜면 전문가에게 나가는 발송(섭외요청
 * 문자·이메일, 재안내, 수락서 송신)이 전부 꺼지고, 회사가 보유한 명단으로
 * 섭외 현황·중복·우선순위만 수기로 관리한다. 확정은 전화 확인 후 수동
 * '섭외 완료(수락서 생성)' 버튼으로 한다.
 *
 * 모듈 추가와 달리 **기능 축소**라 계약(플랜)에 닿지 않는다 — 기업이 스스로
 * 켜고 끈다(캐스트로그 승인 불요). 껐다 켜도 데이터는 그대로다(같은
 * expert_engagements 상태 모델을 쓴다).
 *
 * 민감정보 원칙(§5)은 완화되지 않는다: 주민번호는 전문가 본인 키 재래핑이
 * 없어 라이트에서 기능 자체가 성립하지 않고, 지급·세무 화면은 게이트로 닫는다.
 */
export function parseExpertsLite(featureFlags: Json | null | undefined): boolean {
  if (
    featureFlags === null ||
    featureFlags === undefined ||
    typeof featureFlags !== "object" ||
    Array.isArray(featureFlags)
  ) {
    return false;
  }
  return featureFlags["experts_lite"] === true;
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
