"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/supabase/errors";
import { practiceFromUser } from "@/lib/auth/tenant";
import { explainActionError } from "@/lib/ux/action-errors";
import { requireTenantStaff } from "@/lib/projects/team";
import { findActiveResume, getOrGenerateResumeSummary, type ResumeSummaryView } from "@/lib/ai/resume-summary";

/**
 * 전문가 인사이트 액션 (기획 승인 2026-11-07 — 1단계): 이력서 보기 · AI 이력 요약 · 자격메모 이력.
 * 전문가 목록·섭외 후보 검색·섭외후보 등록·(2단계) 리스트 작성이 같은 액션을 쓴다.
 * 이력서 열람은 RLS(0012 개정)가 판정하고 열람 로그는 기존 서명 URL 경로(issueDocumentViewUrl)가 남긴다.
 */

const NOT_READY = "이 기능은 아직 열리지 않았습니다 (상태 미충족 — 데이터베이스 마이그레이션 0012 적용 전). 관리자에게 적용을 요청해 주세요.";

export type ResumeInfoResult =
  | { ok: true; documentId: string | null; fileName: string | null }
  | { ok: false; error: string };

/** 활성 이력서 유무·문서 id — '이력서 보기' 버튼이 미리보기 창을 열 때 쓴다 */
export async function getExpertResumeInfo(expertId: string): Promise<ResumeInfoResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(expertId).success) return { ok: false, error: "전문가를 확인하세요." };
  const resume = await findActiveResume(expertId);
  return { ok: true, documentId: resume?.documentId ?? null, fileName: resume?.fileName ?? null };
}

export type ResumeSummaryResult = { ok: true; view: ResumeSummaryView } | { ok: false; error: string };

/** AI 이력 요약 — 저장된 것을 꺼내거나(없으면 생성) 다시 만든다 */
export async function getResumeSummary(expertId: string, options: { regenerate?: boolean } = {}): Promise<ResumeSummaryResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(expertId).success) return { ok: false, error: "전문가를 확인하세요." };
  try {
    const view = await getOrGenerateResumeSummary(expertId, { user: gate.actor.user, tenantId: gate.actor.tenantId }, options);
    return { ok: true, view };
  } catch {
    return { ok: false, error: "이력 요약을 만들지 못했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요." };
  }
}

export type QualificationMemoRow = {
  id: string;
  body: string;
  projectId: string | null;
  projectName: string | null;
  authorName: string | null;
  createdAt: string;
  /** 10분 안의 내 메모 — 지울 수 있다 */
  deletable: boolean;
};

export type MemoListResult = { ok: true; rows: QualificationMemoRow[]; ready: boolean } | { ok: false; error: string };

/** 자격메모 이력 — 이 전문가에게 우리 회사가 남긴 메모 전부(프로젝트 무관, 최신순) */
export async function listQualificationMemos(expertId: string): Promise<MemoListResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(expertId).success) return { ok: false, error: "전문가를 확인하세요." };
  const supabase = createClient();
  const { data, error } = await supabase
    .from("expert_qualification_memos")
    .select("id, body, project_id, created_by, created_at")
    .eq("expert_id", expertId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, rows: [], ready: false };
    return { ok: false, error: await explainActionError(error.message, "자격메모를 불러오지 못했습니다 (시스템 오류).") };
  }
  const memos = data ?? [];
  const projectIds = Array.from(new Set(memos.map((m) => m.project_id).filter((v): v is string => Boolean(v))));
  const userIds = Array.from(new Set(memos.map((m) => m.created_by).filter((v): v is string => Boolean(v))));
  const [{ data: projects }, { data: users }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.length > 0
      ? supabase.from("users").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const rows: QualificationMemoRow[] = memos.map((r) => ({
    id: r.id,
    body: r.body,
    projectId: r.project_id,
    // 열람 범위 밖 프로젝트(팀장 이하)는 이름 대신 '다른 프로젝트'
    projectName: r.project_id ? projectName.get(r.project_id) ?? "다른 프로젝트" : null,
    authorName: r.created_by ? userName.get(r.created_by) ?? null : null,
    createdAt: r.created_at,
    deletable: r.created_by === gate.actor.userId && new Date(r.created_at).getTime() > tenMinAgo,
  }));
  return { ok: true, rows, ready: true };
}

const memoSchema = z.object({
  expertId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1, "메모 내용을 입력하세요.").max(500, "자격메모는 500자 이내로 적어 주세요."),
});

export type MemoActionResult = { ok: true } | { ok: false; error: string };

/** 자격메모 추가 — 프로젝트(후보 리스트) 맥락이 있으면 함께 남긴다 */
export async function addQualificationMemo(input: z.infer<typeof memoSchema>): Promise<MemoActionResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  const parsed = memoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const supabase = createClient();
  const { error } = await supabase.from("expert_qualification_memos").insert({
    tenant_id: gate.actor.tenantId,
    expert_id: parsed.data.expertId,
    project_id: parsed.data.projectId ?? null,
    position_id: parsed.data.positionId ?? null,
    body: parsed.data.body,
    created_by: gate.actor.userId,
    is_practice: practiceFromUser(gate.actor.user),
  });
  if (error) {
    if (isMissingTableError(error)) return { ok: false, error: NOT_READY };
    return { ok: false, error: await explainActionError(error.message, "자격메모를 저장하지 못했습니다 (시스템 오류).") };
  }
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}

/** 잘못 쓴 메모 — 본인이 10분 안에만 (RLS도 같은 규칙) */
export async function deleteQualificationMemo(memoId: string): Promise<MemoActionResult> {
  const gate = await requireTenantStaff();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(memoId).success) return { ok: false, error: "메모를 확인하세요." };
  const supabase = createClient();
  const { data, error } = await supabase.from("expert_qualification_memos").delete().eq("id", memoId).select("id");
  if (error) return { ok: false, error: await explainActionError(error.message, "메모를 지우지 못했습니다 (시스템 오류).") };
  if (!data || data.length === 0) {
    return { ok: false, error: "지울 수 없는 메모입니다 (규칙 — 본인이 쓴 메모만 10분 안에 지울 수 있습니다). 이력은 그대로 남습니다." };
  }
  revalidatePath("/[tenantSlug]/projects/[projectId]", "page");
  return { ok: true };
}
