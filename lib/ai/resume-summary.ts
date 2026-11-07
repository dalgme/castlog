import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/supabase/errors";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { EXPERT_DOCUMENT_BUCKET } from "@/lib/experts/documents";

import { generateText, generateWithAttachment, isAiConfigured } from "./client";
import { AI_MODEL, AI_PROMPT_VERSIONS, resumeSummaryInstruction, resumeSummarySystem } from "./prompts";
import { resumeToAiInput } from "./resume-text";

/**
 * AI 이력 요약 (기획 2026-11-07, 08·09번) — 이력서 문서 1건당 1요약을 expert_resume_summaries에 저장해 두고
 * 버튼을 누르면 꺼내 보여 준다. 없으면 그 자리에서 만든다(업로드 직후 비동기 생성이 실패했을 때의 보험).
 *
 * 경계(§14-1): 요약은 설명용. 섭외 결정·순위·비용 판정에 쓰지 않는다. 호출은 audit_logs.
 * 원문은 서버 메모리에서만 다룬다. 요약에는 개인 식별정보를 넣지 않도록 프롬프트가 금지한다.
 */

export type ResumeDocInfo = {
  documentId: string;
  fileName: string;
  mimeType: string | null;
  uploadedAt: string;
};

export type ResumeSummaryView =
  | { status: "ready"; summary: string; generatedAt: string; model: string | null; sourceKind: string | null; fileName: string }
  | { status: "unsupported" | "failed"; note: string; fileName: string }
  | { status: "no_resume" }
  | { status: "ai_disabled"; fileName: string }
  | { status: "not_ready" };

/** 활성 이력서 1건 — RLS가 열람 권한을 판정한다 (0012 개정: 자사 임직원 누구나) */
export async function findActiveResume(expertId: string): Promise<ResumeDocInfo | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("expert_documents")
    .select("id, file_name, mime_type, created_at")
    .eq("expert_id", expertId)
    .eq("document_type", "resume")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { documentId: data.id, fileName: data.file_name, mimeType: data.mime_type, uploadedAt: data.created_at };
}

/** 저장된 요약이 있으면 돌려주고, 없으면 만든다 */
export async function getOrGenerateResumeSummary(
  expertId: string,
  actor: { user: User; tenantId: string | null },
  options: { regenerate?: boolean } = {}
): Promise<ResumeSummaryView> {
  const resume = await findActiveResume(expertId);
  if (!resume) return { status: "no_resume" };

  const admin = createAdminClient();
  if (!options.regenerate) {
    const { data: existing, error } = await admin
      .from("expert_resume_summaries")
      .select("status, summary, generated_at, model, source_kind, error_note")
      .eq("document_id", resume.documentId)
      .maybeSingle();
    if (error && isMissingTableError(error)) return { status: "not_ready" };
    if (existing) {
      if (existing.status === "ready" && existing.summary) {
        return {
          status: "ready",
          summary: existing.summary,
          generatedAt: existing.generated_at,
          model: existing.model,
          sourceKind: existing.source_kind,
          fileName: resume.fileName,
        };
      }
      // 실패·미지원 기록은 다시 시도한다 (파일이 바뀌지 않았으니 결과도 같겠지만, 모델·파서가 나아졌을 수 있다)
    }
  }
  if (!isAiConfigured()) return { status: "ai_disabled", fileName: resume.fileName };

  const generated = await generateResumeSummaryForDocument(resume.documentId, actor);
  if (generated.status === "ready") return { ...generated, fileName: resume.fileName };
  if (generated.status === "not_ready") return generated;
  return { status: generated.status, note: generated.note, fileName: resume.fileName };
}

type GenerateOutcome =
  | { status: "ready"; summary: string; generatedAt: string; model: string; sourceKind: string }
  | { status: "unsupported" | "failed"; note: string }
  | { status: "not_ready" };

/**
 * 문서 1건의 요약 생성·저장 (service_role). 업로드 직후(전문가 포털·기업 대리 업로드)와
 * 버튼 클릭 시 호출된다. actor가 없으면 시스템 호출(업로드 훅).
 */
export async function generateResumeSummaryForDocument(
  documentId: string,
  actor: { user: User; tenantId: string | null } | null
): Promise<GenerateOutcome> {
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("expert_documents")
    .select("id, expert_id, document_type, storage_path, file_name, mime_type, status, experts(name)")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.document_type !== "resume" || doc.status !== "active") {
    return { status: "failed", note: "활성 이력서가 아닙니다." };
  }
  const expertRel = doc.experts as { name: string } | { name: string }[] | null;
  const expertName = Array.isArray(expertRel) ? expertRel[0]?.name ?? "전문가" : expertRel?.name ?? "전문가";

  const { data: blob, error: dlError } = await admin.storage.from(EXPERT_DOCUMENT_BUCKET).download(doc.storage_path);
  if (dlError || !blob) return await record(admin, doc, { status: "failed", note: "이력서 파일을 읽지 못했습니다 (저장소 오류)." }, null);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const input = await resumeToAiInput({ bytes, fileName: doc.file_name, mimeType: doc.mime_type });
  if (input.kind === "unsupported") return await record(admin, doc, { status: "unsupported", note: input.reason }, null);

  const system = resumeSummarySystem();
  const instruction = resumeSummaryInstruction(expertName);
  const result =
    input.kind === "text"
      ? await generateText({ system, user: `${instruction}\n\n----- 이력서 본문 -----\n${input.text}`, maxTokens: 900 })
      : await generateWithAttachment({
          system,
          instruction,
          attachment: input.kind === "pdf" ? { kind: "pdf", base64: input.base64 } : { kind: "image", mediaType: input.mediaType, base64: input.base64 },
          maxTokens: 900,
        });

  // 호출 자체를 감사로그에 — 이력서 원문이 외부 API로 갔다는 사실과 프롬프트 버전 (§14-1)
  await admin.from("audit_logs").insert({
    tenant_id: actor?.tenantId ?? null,
    actor_auth_user_id: actor?.user.id ?? null,
    actor_role: actor ? roleFromUser(actor.user) ?? "system" : "system",
    action: "ai.resume_summary",
    resource_type: "expert_document",
    resource_id: doc.id,
    after_data: {
      expert_id: doc.expert_id,
      prompt_version: AI_PROMPT_VERSIONS.resume_summary,
      model: AI_MODEL,
      source_kind: input.sourceKind,
      ok: result.ok,
    },
  });

  if (!result.ok) return await record(admin, doc, { status: "failed", note: result.error }, input.sourceKind);
  const summary = result.text.trim();
  return await record(admin, doc, { status: "ready", summary }, input.sourceKind);
}

async function record(
  admin: ReturnType<typeof createAdminClient>,
  doc: { id: string; expert_id: string },
  outcome: { status: "ready"; summary: string } | { status: "unsupported" | "failed"; note: string },
  sourceKind: string | null
): Promise<GenerateOutcome> {
  const generatedAt = new Date().toISOString();
  const row = {
    expert_id: doc.expert_id,
    document_id: doc.id,
    status: outcome.status,
    summary: outcome.status === "ready" ? outcome.summary : null,
    model: outcome.status === "ready" ? AI_MODEL : null,
    prompt_version: AI_PROMPT_VERSIONS.resume_summary,
    source_kind: sourceKind,
    error_note: outcome.status === "ready" ? null : outcome.note,
    generated_at: generatedAt,
  };
  const { error } = await admin.from("expert_resume_summaries").upsert(row, { onConflict: "document_id" });
  if (error && isMissingTableError(error)) return { status: "not_ready" };
  if (outcome.status === "ready") {
    return { status: "ready", summary: outcome.summary, generatedAt, model: AI_MODEL, sourceKind: sourceKind ?? "" };
  }
  return { status: outcome.status, note: outcome.note };
}

/** 업로드 훅 — 기다리지 않고 시도한다. 실패해도 버튼 클릭 때 다시 만든다 */
export function scheduleResumeSummary(documentId: string, user: User | null): void {
  if (!isAiConfigured()) return;
  void generateResumeSummaryForDocument(documentId, user ? { user, tenantId: tenantIdFromUser(user) } : null).catch(() => {
    /* 보험: 버튼 클릭 시 재생성 */
  });
}
