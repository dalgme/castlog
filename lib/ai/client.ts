import "server-only";

import { AI_MODEL } from "./prompts";

/**
 * 단계 25: Anthropic Messages API 래퍼 (서버 전용 — CLAUDE.md 2·14-1).
 *
 * - ANTHROPIC_API_KEY 미설정 시 기능은 우아하게 비활성(더미 금지 — 14-7).
 * - SDK 의존성 없이 fetch로 호출(번들 경량·의존성 최소).
 * - AI 산출물은 '초안'일 뿐, 담당자가 검토·수정·확정한다(경계).
 */

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function generateText(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI가 설정되지 않았습니다 (ANTHROPIC_API_KEY 미설정)." };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: params.maxTokens ?? 600,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `AI 응답 오류 (${res.status})` };
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = Array.isArray(data.content)
      ? data.content
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("")
          .trim()
      : "";

    if (!text) {
      return { ok: false, error: "AI 응답이 비어 있습니다." };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: "AI 호출에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
