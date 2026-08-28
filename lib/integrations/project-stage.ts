/**
 * 프로젝트 섭외 단계 (클라이언트·서버 공용).
 *
 * 프로젝트는 한 덩어리로 움직인다: 자리를 전부 채우고 → 그 명단으로 품의를
 * 올리고 → 결재가 떨어지면 전원에게 한 번에 요청을 보내고 → 전원이 수락하면
 * 수락서를 한 번에 보낸다. **버튼이 언제 열리는지는 이 단계 하나로 정한다** —
 * 화면마다 조건을 따로 계산하면 어긋난다.
 */

export const PROJECT_STAGES = [
  "assigning",
  "plan_review",
  "plan_approved",
  "requesting",
  "accepted_all",
  "letters_sent",
  "confirmed",
  "closing",
  "settlement_review",
  "settled",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  assigning: "임의 배정 중",
  plan_review: "섭외 품의 결재 중",
  plan_approved: "결재 완료 · 섭외 진행 가능",
  requesting: "섭외 요청 발송됨",
  accepted_all: "전원 수락 · 수락서 송부 가능",
  letters_sent: "수락서 송부됨",
  confirmed: "전원 확정",
  closing: "프로젝트 종료 진행",
  settlement_review: "지급 품의 검토 중",
  settled: "종료 및 지급 품의 완료",
};

export const PROJECT_STAGE_DESCRIPTIONS: Record<ProjectStage, string> = {
  assigning:
    "코드넘버마다 전문가를 찾아 배정하는 단계입니다. 아직 아무에게도 나가지 않았습니다.",
  plan_review:
    "배정 명단으로 섭외 품의를 올렸습니다. 결재가 끝나야 요청을 보낼 수 있습니다.",
  plan_approved:
    "결재가 끝났습니다. 첨부를 준비한 뒤 ‘섭외 진행’으로 전원에게 요청을 보내세요.",
  requesting: "전문가들의 회신을 기다립니다. 수락 여부가 자동으로 반영됩니다.",
  accepted_all:
    "전원이 수락했습니다. 수락서가 자동 생성되었으니 첨부를 붙여 송부하세요.",
  letters_sent:
    "수락서를 보냈습니다. 전문가가 캐스트로그에서 확인·서명하면 확정됩니다.",
  confirmed: "전원 확정. 행사 운영 단계입니다.",
  closing: "참여율과 만족도를 입력하는 단계입니다.",
  settlement_review: "회계담당자가 지급 내역과 지급품의서를 검토합니다.",
  settled: "종료 및 지급 품의가 끝났습니다.",
};

export function isProjectStage(value: unknown): value is ProjectStage {
  return (
    typeof value === "string" &&
    (PROJECT_STAGES as readonly string[]).includes(value)
  );
}

export function projectStage(value: unknown): ProjectStage {
  return isProjectStage(value) ? value : "assigning";
}

export function stageIndex(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

/** stage가 target 이상까지 왔는가 (되돌아간 경우를 구분하려면 직접 비교할 것) */
export function stageAtLeast(stage: ProjectStage, target: ProjectStage): boolean {
  return stageIndex(stage) >= stageIndex(target);
}
