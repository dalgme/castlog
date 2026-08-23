"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { canExec, execDeniedMessage } from "@/lib/auth/exec-permissions";
import { gradeFromUser } from "@/lib/auth/tenant";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import {
  rankExpertCandidates,
  type ExpertCandidate,
} from "@/lib/integrations/recommendations";
import { generateText, isAiConfigured } from "@/lib/ai/client";
import {
  AI_PROMPT_VERSIONS,
  engagementRationaleSystem,
  engagementRationaleUser,
} from "@/lib/ai/prompts";

type Session = { userId: string; tenantId: string; role: string };

async function requireRecommendSession(): Promise<
  { ok: true; session: Session } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role) {
    return { ok: false, error: "로그인이 필요합니다." };
  }
  if (!canExec("expertRecord", gradeFromUser(user), role)) {
    return { ok: false, error: execDeniedMessage("expertRecord") };
  }
  return { ok: true, session: { userId: user.id, tenantId, role } };
}

export type RecommendResult =
  | { ok: true; candidates: ExpertCandidate[]; aiConfigured: boolean }
  | { ok: false; error: string };

/** 결정론적 후보 추천 (평판 + 프로필). AI 아님. */
export async function recommendExperts(input: {
  keyword?: string;
}): Promise<RecommendResult> {
  const auth = await requireRecommendSession();
  if (!auth.ok) return auth;

  const candidates = await rankExpertCandidates({
    keyword: input.keyword,
    limit: 5,
  });
  return { ok: true, candidates, aiConfigured: isAiConfigured() };
}

export type ShortlistResult =
  | { ok: true; added: number; skipped: { name: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * 추천 후보 중 고른 사람을 즐겨찾기에 담는다 (후보 명단 확정).
 *
 * 추천 팝업은 프로젝트·세션에 매여 있지 않아 여기서 바로 섭외요청을 만들 수 없다.
 * 대신 고른 사람을 자사 즐겨찾기로 남겨 두면, 나중에 코드넘버에서 후보를 고를 때
 * 맨 위에서 다시 만나게 된다.
 *
 * **이미 등급이 있는 전문가는 건너뛴다.** 특히 '주의' 등급은 이유가 있어 붙은
 * 것이라, 즐겨찾기로 덮어 쓰면 그 경고가 조용히 사라진다.
 */
export async function shortlistExperts(input: {
  expertIds: string[];
}): Promise<ShortlistResult> {
  const auth = await requireRecommendSession();
  if (!auth.ok) return auth;

  const expertIds = Array.from(new Set(input.expertIds)).slice(0, 50);
  if (expertIds.length === 0) {
    return { ok: false, error: "선택한 전문가가 없습니다." };
  }

  const supabase = createClient();

  const [{ data: links }, { data: existingTags }, { data: experts }] =
    await Promise.all([
      supabase
        .from("expert_tenant_links")
        .select("expert_id, status")
        .in("expert_id", expertIds),
      supabase
        .from("expert_tenant_tags")
        .select("expert_id, tag")
        .in("expert_id", expertIds),
      supabase.from("experts").select("id, name").in("id", expertIds),
    ]);

  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));
  const activeLinks = new Set(
    (links ?? []).filter((l) => l.status === "active").map((l) => l.expert_id)
  );
  const tagByExpert = new Map(
    (existingTags ?? []).map((t) => [t.expert_id, t.tag])
  );

  const skipped: { name: string; reason: string }[] = [];
  const targets: string[] = [];
  for (const id of expertIds) {
    const name = nameById.get(id) ?? "(전문가)";
    if (!activeLinks.has(id)) {
      skipped.push({ name, reason: "활성 연결이 아닙니다" });
      continue;
    }
    const tag = tagByExpert.get(id);
    if (tag === "favorite") {
      skipped.push({ name, reason: "이미 즐겨찾기입니다" });
      continue;
    }
    if (tag) {
      skipped.push({ name, reason: `이미 다른 등급(${tag})이 지정되어 있습니다` });
      continue;
    }
    targets.push(id);
  }

  if (targets.length > 0) {
    const { error } = await supabase.from("expert_tenant_tags").upsert(
      targets.map((id) => ({
        tenant_id: auth.session.tenantId,
        expert_id: id,
        tag: "favorite",
        created_by: auth.session.userId,
      })),
      { onConflict: "tenant_id,expert_id" }
    );
    if (error) return { ok: false, error: "즐겨찾기 지정에 실패했습니다." };

    await supabase.from("audit_logs").insert(
      targets.map((id) => ({
        tenant_id: auth.session.tenantId,
        actor_auth_user_id: auth.session.userId,
        actor_role: auth.session.role,
        action: "expert_tag.set",
        resource_type: "expert",
        resource_id: id,
        after_data: { tag: "favorite", via: "recommendation" },
      }))
    );
  }

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true, added: targets.length, skipped };
}

export type DraftResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * 단계 25: 섭외 사유 초안 생성 (AI — 문장화만). 담당자가 검토·수정·확정한다.
 * 자사 평판(격리)만 사실로 주입. 프롬프트 버전을 audit_logs에 남긴다(롤백 추적).
 */
export async function draftEngagementRationale(input: {
  expertId: string;
  roleDescription: string;
  projectId?: string;
}): Promise<DraftResult> {
  const auth = await requireRecommendSession();
  if (!auth.ok) return auth;
  const { session } = auth;

  const roleDescription = input.roleDescription?.trim();
  if (!roleDescription) {
    return { ok: false, error: "섭외 역할을 먼저 입력하세요." };
  }
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "AI 초안 기능이 설정되지 않았습니다 (관리자에게 문의).",
    };
  }

  const supabase = createClient();

  // 자사 연결 전문가만 (RLS + 명시 확인)
  const { data: link } = await supabase
    .from("expert_tenant_links")
    .select("status, experts (id, name, specialty, region, career_years)")
    .eq("expert_id", input.expertId)
    .eq("status", "active")
    .maybeSingle();
  const expert = link?.experts ?? null;
  if (!expert) {
    return { ok: false, error: "자사에 연결된 전문가만 초안을 생성할 수 있습니다." };
  }

  // 자사 평판 집계 (테넌트 격리 — RLS)
  const { data: evals } = await supabase
    .from("expert_evaluations")
    .select("score")
    .eq("expert_id", input.expertId);
  const evalCount = evals?.length ?? 0;
  const avgScore =
    evalCount > 0
      ? (evals ?? []).reduce((s, r) => s + r.score, 0) / evalCount
      : null;

  let projectName: string | null = null;
  if (input.projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", input.projectId)
      .maybeSingle();
    projectName = project?.name ?? null;
  }

  const result = await generateText({
    system: engagementRationaleSystem(),
    user: engagementRationaleUser({
      expertName: expert.name,
      specialty: expert.specialty,
      region: expert.region,
      careerYears: expert.career_years,
      avgScore,
      evalCount,
      roleDescription,
      projectName,
    }),
    maxTokens: 600,
  });

  // AI 호출 감사 — 프롬프트 버전 기록 (버전관리·롤백 추적, CLAUDE.md 14-1)
  await supabase.from("audit_logs").insert({
    tenant_id: session.tenantId,
    actor_auth_user_id: session.userId,
    actor_role: session.role,
    action: "ai.engagement_rationale_draft",
    resource_type: "expert",
    resource_id: input.expertId,
    after_data: {
      prompt_version: AI_PROMPT_VERSIONS.engagement_rationale,
      ok: result.ok,
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, text: result.text };
}
