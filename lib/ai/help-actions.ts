"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  gradeFromUser,
  practiceFromUser,
  roleFromUser,
  tenantIdFromUser,
} from "@/lib/auth/tenant";
import { gradeLabel } from "@/lib/auth/grades";
import { getTenantModules } from "@/lib/modules/server";
import { MODULE_KEYS, MODULE_LABELS } from "@/lib/modules/modules";

import { generateChat, isAiConfigured, type ChatMessage } from "./client";
import { helpSystemPrompt, HELP_PROMPT_VERSION } from "./help-prompts";

export type HelpAnswer = { ok: true; text: string } | { ok: false; error: string };

/** 한 번에 보낼 수 있는 글자 수 — 대화창에 문서를 붙여 넣는 사용을 막는다 */
const MAX_MESSAGE_CHARS = 1000;
/** 넘겨줄 직전 대화 수 (사용자·도우미 합쳐서) */
const MAX_HISTORY = 8;

/**
 * 사용법 도우미 응답.
 *
 * 로그인한 기업 사용자만 쓴다. 회사 이름·직급·사용 모듈만 맥락으로 넘기고
 * **실제 업무 데이터는 넘기지 않는다** — 프로젝트·전문가·금액은 이 대화에
 * 실릴 이유가 없고, 실리면 그 순간 외부 API로 나간다.
 */
export async function askHelpBot(input: {
  messages: ChatMessage[];
  path?: string;
}): Promise<HelpAnswer> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  if (!isAiConfigured()) {
    return {
      ok: false,
      error:
        "도우미가 아직 켜지지 않았습니다. 캐스트로그 관리자에게 문의해 주세요.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || role === "expert") {
    return { ok: false, error: "로그인이 필요합니다." };
  }

  const history = input.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .filter((m) => m.content.trim().length > 0);
  if (history.length === 0 || history[history.length - 1]?.role !== "user") {
    return { ok: false, error: "질문을 입력해 주세요." };
  }

  const [{ data: tenant }, modules] = await Promise.all([
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    getTenantModules(),
  ]);

  const result = await generateChat({
    system: helpSystemPrompt({
      tenantName: tenant?.name ?? null,
      gradeLabel: gradeLabel(gradeFromUser(user)),
      moduleLabels: MODULE_KEYS.filter((k) => modules[k]).map(
        (k) => MODULE_LABELS[k]
      ),
      path: input.path ?? null,
      practice: practiceFromUser(user),
    }),
    messages: history,
    maxTokens: 700,
  });

  if (!result.ok) return { ok: false, error: result.error };

  // 사용량 계측 — 질문 내용은 남기지 않는다 (사용법 질문에도 업무 맥락이 섞인다)
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: user.id,
    actor_role: role,
    action: "help_bot.ask",
    resource_type: "ai",
    resource_id: null,
    after_data: { prompt_version: HELP_PROMPT_VERSION, turns: history.length },
  });

  return { ok: true, text: result.text };
}
