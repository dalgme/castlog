import "server-only";

import { generateChat, type ChatMessage } from "./client";

/**
 * 챗봇 대화에서 '기록해 둘 목소리'를 걸러낸다.
 *
 * 왜 자동 분류인가: 사용자에게 '건의하기' 버튼을 따로 누르게 하면, 정작 막혀서
 * 짜증이 난 순간에는 아무도 누르지 않는다. 불편은 대화 속에서 지나가듯 나온다
 * ("이거 어디 있는지 한참 찾았어요", "저장이 안 되는데요"). 그 말을 그 자리에서
 * 주워 담아야 화면을 고칠 단서가 남는다.
 *
 * AI는 **분류와 문장화만** 한다 (CLAUDE.md §14-1). 처리 여부·우선순위 판정은
 * 사람이 관리모드에서 한다.
 */

export type FeedbackKind = "suggestion" | "bug" | "confusion";

export type ClassifiedFeedback = {
  kind: FeedbackKind;
  title: string;
  summary: string;
};

const SYSTEM = [
  "당신은 SaaS 사용자 대화에서 제품 개선 단서를 뽑아내는 분류기입니다.",
  "",
  "사용자의 마지막 메시지를 읽고 아래 셋 중 하나로 판단하세요.",
  "- bug: 동작하지 않는다·오류가 난다·저장이 안 된다 등 고장 신고",
  "- suggestion: 불편하다·이런 게 있으면 좋겠다 등 개선 요청",
  "- confusion: 어디서 하는지 모르겠다·버튼을 못 찾겠다·순서를 모르겠다 등",
  "  화면을 이해하지 못한 상담 (단순 사용법 질문도 여기에 해당합니다)",
  "- none: 위 어디에도 해당하지 않는 잡담·인사·감사 인사",
  "",
  "출력은 **JSON 한 줄만**. 설명·코드블록·따옴표 밖 텍스트를 붙이지 마세요.",
  '형식: {"kind":"bug|suggestion|confusion|none","title":"20자 이내 제목","summary":"한두 문장 요약"}',
  "",
  "규칙:",
  "- title·summary는 한국어 평서문으로, 사용자의 말을 그대로 옮기지 말고 정리해서 쓰세요.",
  "- 사람 이름·전화번호·주민등록번호·계좌·금액은 절대 옮겨 적지 마세요.",
  "- 판단이 애매하면 none을 고르세요. 잘못 쌓인 기록은 안 쌓인 것만 못합니다.",
].join("\n");

function parseKind(value: unknown): FeedbackKind | null {
  return value === "suggestion" || value === "bug" || value === "confusion"
    ? value
    : null;
}

/**
 * @returns 기록할 것이 있으면 분류 결과, 없으면 null
 */
export async function classifyFeedback(
  messages: ChatMessage[]
): Promise<ClassifiedFeedback | null> {
  // 직전 두 턴이면 충분하다 — 분류에 대화 전체가 필요하지 않다
  const tail = messages.slice(-2);
  if (tail.length === 0) return null;

  const result = await generateChat({
    system: SYSTEM,
    messages: tail,
    maxTokens: 250,
  });
  if (!result.ok) return null;

  // 모델이 코드블록을 붙이는 경우가 있어 첫 중괄호 구간만 떼어 낸다
  const start = result.text.indexOf("{");
  const end = result.text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const value = parsed as Record<string, unknown>;
  const kind = parseKind(value.kind);
  if (!kind) return null;

  const title = typeof value.title === "string" ? value.title.trim() : "";
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!title || !summary) return null;

  return {
    kind,
    title: title.slice(0, 80),
    summary: summary.slice(0, 500),
  };
}
