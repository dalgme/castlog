/**
 * 단계 25: AI 프롬프트 레지스트리 (경계 준수 — CLAUDE.md 14-1)
 *
 * - AI는 설명·문장화만. 권한·결재·지급·데이터 판정 근거로 쓰지 않는다.
 * - 프롬프트는 버전 관리·롤백 가능해야 한다(14-1). 버전 문자열을 호출 로그에 남긴다.
 * - 프롬프트 자체는 이 파일(git 버전 관리)에 두고, 변경 시 버전을 올린다.
 */

/** 현재 활성 프롬프트 버전 (변경 시 반드시 올릴 것) */
export const AI_PROMPT_VERSIONS = {
  engagement_rationale: "v1.0.0",
  resume_summary: "v1.0.0",
} as const;

/**
 * AI 이력 요약 — 시스템 프롬프트 (기획 2026-11-07, 08번).
 * 요약은 설명용 참고 정보다. 섭외 결정·순위·비용 판정에 쓰지 않는다 (§14-1).
 * 개인 식별정보(연락처·주소·주민번호·생년월일)는 요약에 넣지 않는다 (§5).
 */
export function resumeSummarySystem(): string {
  return [
    "당신은 창업교육·컨설팅 기업의 섭외 담당자를 돕는 '이력서 요약 보조 도구'입니다.",
    "입력된 이력서(문서 또는 추출 텍스트)를 읽고 담당자가 후보를 빠르게 파악할 수 있는 한국어 요약을 작성합니다.",
    "",
    "규칙:",
    "- 이력서에 적힌 사실만 쓰고, 없는 내용을 추측하거나 지어내지 마세요. 확인되지 않으면 '기재 없음'이라고 쓰세요.",
    "- 연락처·주소·주민등록번호·생년월일·계좌 등 개인 식별정보는 절대 요약에 포함하지 마세요.",
    "- 평가·추천·적합 판정을 하지 마세요. 섭외 여부와 비용은 담당자가 판단합니다.",
    "- 아래 다섯 항목을 각각 한 줄(최대 80자)로, '항목: 내용' 형식으로만 출력하세요. 머리말·꼬리말 없이.",
    "  전문분야: / 경력: / 강의·멘토링 경험: / 학력·자격: / 특기사항:",
  ].join("\n");
}

export function resumeSummaryInstruction(expertName: string): string {
  return `아래 문서는 전문가 '${expertName}'의 이력서입니다. 규칙에 따라 다섯 항목으로 요약하세요.`;
}

/** 사용 모델 (최신 Claude 기본) */
export const AI_MODEL = "claude-sonnet-5";

export type RationaleFacts = {
  expertName: string;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  avgScore: number | null; // 자사 평판 평균(10점) — 없으면 null
  evalCount: number; // 자사 평가 건수
  roleDescription: string; // 섭외하려는 역할
  projectName: string | null;
};

/** 섭외 사유 초안 — 시스템 프롬프트 (경계·형식 고정) */
export function engagementRationaleSystem(): string {
  return [
    "당신은 창업교육·컨설팅 기업의 섭외 담당자를 돕는 '초안 작성 보조 도구'입니다.",
    "당신의 역할은 담당자가 검토·수정할 '섭외 사유 초안'을 한국어로 작성하는 것뿐입니다.",
    "",
    "규칙:",
    "- 제공된 사실(전문가 프로필·자사 평판 요약·역할)만 사용하고 없는 내용을 지어내지 마세요.",
    "- 결정·비용 산정·승인은 담당자가 합니다. 단정적 추천이나 금액 제안을 하지 마세요.",
    "- 3~4문장의 공손하고 간결한 업무 문체로 작성하세요.",
    "- 개인정보(주민등록번호·연락처 등)는 언급하지 마세요.",
    "- 출력은 사유 본문만 반환하세요. 머리말·꼬리말·따옴표 없이.",
  ].join("\n");
}

/** 섭외 사유 초안 — 사용자 프롬프트 (사실만 주입) */
export function engagementRationaleUser(facts: RationaleFacts): string {
  const reputation =
    facts.avgScore !== null
      ? `자사 과거 평가 평균 ${(facts.avgScore / 2).toFixed(1)}/5 (${facts.evalCount}건)`
      : "자사 과거 평가 없음";
  const lines = [
    `역할: ${facts.roleDescription}`,
    facts.projectName ? `프로젝트: ${facts.projectName}` : null,
    `전문가: ${facts.expertName}`,
    facts.specialty ? `전문분야: ${facts.specialty}` : null,
    facts.region ? `활동지역: ${facts.region}` : null,
    facts.careerYears !== null ? `경력: ${facts.careerYears}년` : null,
    `평판: ${reputation}`,
    "",
    "위 사실을 바탕으로 이 전문가를 해당 역할로 섭외하려는 사유 초안을 작성하세요.",
  ].filter((v): v is string => v !== null);
  return lines.join("\n");
}
