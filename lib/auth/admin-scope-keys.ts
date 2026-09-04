/**
 * 관리권한 위임 스코프 상수 (클라이언트 컴포넌트 공용).
 * 서버 가드(requireAdminScope 등)는 lib/auth/admin-scopes.ts 에 있다.
 *
 * ── 왜 세분화했나 ────────────────────────────────────────────────────────────
 * 처음에는 5개(설정·직원·발송·감사·지급)였는데, 하나가 너무 넓었다. '발송'을
 * 맡기면 문자 문구를 고치는 사람에게 **API 키까지** 열렸고, '감사'를 맡기면
 * 로그를 읽는 사람에게 **회사 데이터 전체 반출**까지 열렸다. 위험도가 다른
 * 일이 한 스위치에 묶여 있으면, 필요한 권한을 주려다 필요 없는 권한까지 준다.
 *
 * 그래서 위험도가 다른 지점에서 잘랐다:
 *  - 발송: 자격증명(키·발신번호) ↔ 문구(템플릿)
 *  - 감사: 읽기(로그·보안현황) ↔ 반출(파일로 빼내기)
 *  - 설정: 회사 설정 ↔ 계약(사용 기능 요청)
 *  - 결재: 전결규정은 결재 흐름 자체를 바꾸는 권한이라 회사 설정과 분리
 *
 * ── 상위가 하위를 포함한다 ──────────────────────────────────────────────────
 * 이미 위임해 둔 권한이 세분화 때문에 갑자기 끊기면 안 된다. 넓은 스코프는
 * 그 안에서 갈라져 나온 스코프를 포함한다(SCOPE_IMPLIES). 판정은 서버와 DB
 * 양쪽에서 같은 규칙으로 한다.
 */

export const ADMIN_SCOPES = [
  "settings",
  "modules",
  "staff",
  "sending",
  "templates",
  "approvals",
  "audit",
  "backup",
  "finance",
] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

export const ADMIN_SCOPE_LABELS: Record<AdminScope, string> = {
  settings: "회사 정보·기본 설정",
  modules: "사용 기능 요청 (계약)",
  staff: "임직원 계정·직급",
  sending: "문자 발송 자격증명",
  templates: "발송 문구·템플릿",
  approvals: "전결규정",
  audit: "감사로그·보안 현황",
  backup: "데이터 반출",
  finance: "지급·정산 (금액)",
};

/** 위임할 때 실제로 무엇이 열리는지 — 화면 이름까지 적는다 */
export const ADMIN_SCOPE_DESCRIPTIONS: Record<AdminScope, string> = {
  settings:
    "‘설정 > 기업관리’에서 사업자 정보·개인정보 보호책임자·주소·업종과 프로젝트 카테고리, 회사 로고를 바꿀 수 있습니다. 임직원 계정과 금액에는 접근하지 못합니다.",
  modules:
    "‘설정 > 기업관리 > 사용 기능’에서 전문가 섭외·전자결재·행사 운영 중 쓰지 않는 영역의 사용을 캐스트로그에 요청하고, 요청을 취소할 수 있습니다. 스스로 켤 수는 없습니다 — 계약 사항이라 캐스트로그가 승인합니다.",
  staff:
    "‘설정 > 임직원 설정’ 전체입니다. 가입 신청 승인, 직원 계정 직접 생성, 권한단계 변경, 비활성 처리, 직급 체계 관리에 더해 기능별 권한 문턱·역할별 최소 레벨 조정까지 포함합니다 — 대표가 올려 둔 통제를 이 위임자가 되돌릴 수 있으니 신중히 주세요. 대표 등급을 부여하는 것만은 대표만 가능합니다.",
  sending:
    "‘설정 > SMS 설정’에서 문자 공급자(솔라피 등) API 키와 발신번호를 등록·교체하고 테스트 발송을 할 수 있습니다. 키를 다루는 권한이므로 문구만 고칠 사람에게는 아래 ‘발송 문구·템플릿’을 주세요.",
  templates:
    "섭외 요청·세션 안내 등 발송 문구와 템플릿을 고칠 수 있습니다. API 키·발신번호에는 접근하지 못합니다.",
  approvals:
    "‘설정 > 전결규정’에서 금액 구간·결재유형별 결재선을 만들고 고칠 수 있습니다. 결재 흐름 자체를 바꾸는 권한이라 회사 설정과 따로 둡니다. 개별 품의를 승인하는 권한은 아닙니다 — 그건 결재선에 들어가야 생깁니다.",
  audit:
    "감사로그와 보안 현황(주민등록번호 조회 이력·잠금 상태)을 읽을 수 있습니다. 회사의 보안책임자 자리입니다. 주민등록번호 자체를 조회하는 권한은 아닙니다.",
  backup:
    "회사 데이터를 파일로 반출할 수 있습니다. 한 번에 회사 자료 전부가 밖으로 나가므로 감사로그 열람과 분리해 두었습니다. 꼭 필요한 사람에게만 주세요.",
  finance:
    "지급 대상·지급 품의·정산 금액을 열람하고 처리할 수 있습니다. 대표·이사는 위임 없이도 가집니다. 주민등록번호 조회 권한은 포함되지 않습니다 — 그건 세무 조회 지정자만 가능하며 위임할 수 없습니다.",
};

/**
 * 위임의 위험도 — 화면에서 색으로 가른다.
 * 'high'는 회사 밖으로 자료가 나가거나 돈·자격증명이 걸린 권한이다.
 */
export const ADMIN_SCOPE_RISK: Record<AdminScope, "normal" | "high"> = {
  settings: "normal",
  modules: "normal",
  staff: "high",
  sending: "high",
  templates: "normal",
  approvals: "high",
  audit: "normal",
  backup: "high",
  finance: "high",
};

/** 화면에서 묶어 보여 줄 갈래 */
export const ADMIN_SCOPE_GROUPS: {
  key: string;
  title: string;
  scopes: readonly AdminScope[];
}[] = [
  { key: "company", title: "회사 설정", scopes: ["settings", "modules"] },
  { key: "people", title: "사람", scopes: ["staff"] },
  { key: "sending", title: "발송", scopes: ["sending", "templates"] },
  { key: "money", title: "결재·지급", scopes: ["approvals", "finance"] },
  { key: "security", title: "보안·기록", scopes: ["audit", "backup"] },
];

/**
 * 넓은 스코프가 포함하는 하위 스코프.
 *
 * 세분화 이전에 부여한 위임이 그대로 살아 있어야 한다 — 어느 날 갑자기
 * "어제까지 되던 게 안 된다"가 되면 그건 우리가 만든 사고다.
 */
export const SCOPE_IMPLIES: Partial<Record<AdminScope, readonly AdminScope[]>> = {
  settings: ["modules"],
  sending: ["templates"],
  audit: ["backup"],
};

export function isAdminScope(value: unknown): value is AdminScope {
  return (
    typeof value === "string" && (ADMIN_SCOPES as readonly string[]).includes(value)
  );
}

export type AdminScopeSet = Record<AdminScope, boolean>;

/** 부여된 스코프 집합에 포함 관계를 펼쳐 넣는다 (서버·화면 공용) */
export function expandScopes(granted: readonly AdminScope[]): AdminScope[] {
  const out: AdminScope[] = [];
  const push = (scope: AdminScope) => {
    if (!out.includes(scope)) out.push(scope);
  };
  for (const scope of granted) {
    push(scope);
    for (const implied of SCOPE_IMPLIES[scope] ?? []) push(implied);
  }
  return out;
}
