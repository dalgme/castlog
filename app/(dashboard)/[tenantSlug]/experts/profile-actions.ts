"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { explainActionError } from "@/lib/ux/action-errors";

export type ProfileActionResult = { ok: true } | { ok: false; error: string };

type Gate =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string };

/** 평점·메모는 회사의 주관 기록 — 팀장 이상(manager)부터, RLS와 같은 기준 */
async function gate(): Promise<Gate> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  const role = roleFromUser(user);
  if (!user || !tenantId || !role || !["org_admin", "manager"].includes(role)) {
    return { ok: false, error: "전문가 관리 권한이 없습니다 (팀장 이상)." };
  }
  const modules = await getTenantModules();
  if (!modules.experts) {
    return { ok: false, error: "전문가 모듈이 비활성화된 테넌트입니다." };
  }
  return { ok: true, tenantId, userId: user.id };
}

const ratingSchema = z.object({
  expertId: z.string().uuid(),
  rating: z.number().int().min(1).max(10).nullable(),
  note: z.string().trim().max(300),
});

/**
 * 자사 평점 직접 지정 (기획 확정 2026-08-23 — 전문가 목록에서 수정).
 * 값은 expert_tenant_profiles.rating에, 변경 자체는 expert_rating_logs에 남는다.
 * 전문가 본인에게는 보이지 않는다 (RLS).
 */
export async function setExpertRating(input: {
  expertId: string;
  rating: number | null;
  note: string;
}): Promise<ProfileActionResult> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = ratingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("expert_tenant_profiles").upsert(
    {
      tenant_id: g.tenantId,
      expert_id: parsed.data.expertId,
      rating: parsed.data.rating,
      updated_by: g.userId,
    },
    { onConflict: "tenant_id,expert_id" }
  );
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "평점 저장에 실패했습니다."),
    };
  }

  // 변경 로그 — 누가 언제 몇 점으로 (실패해도 값 저장은 유지, 조용히 넘기지 않도록 기록 시도)
  await supabase.from("expert_rating_logs").insert({
    tenant_id: g.tenantId,
    expert_id: parsed.data.expertId,
    kind: "rating",
    value: parsed.data.rating === null ? "해제" : `${parsed.data.rating}점`,
    note: parsed.data.note || null,
    created_by: g.userId,
  });

  revalidatePath("/[tenantSlug]/experts", "page");
  revalidatePath("/[tenantSlug]/experts/manage", "page");
  return { ok: true };
}

export type RatingLogRow = {
  id: string;
  kind: string;
  value: string;
  note: string | null;
  authorName: string;
  createdAt: string;
};

/** 평점·등급 변경 로그 조회 (자사분만 — RLS) */
export async function getExpertRatingLogs(
  expertId: string
): Promise<{ ok: true; rows: RatingLogRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!z.string().uuid().safeParse(expertId).success) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("expert_rating_logs")
    .select("id, kind, value, note, created_at, users (name)")
    .eq("expert_id", expertId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return { ok: false, error: "로그를 불러오지 못했습니다. 마이그레이션 미적용일 수 있습니다." };
  }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      value: r.value,
      note: r.note,
      authorName: r.users?.name ?? "(직원)",
      createdAt: r.created_at,
    })),
  };
}

export type ExpertNoteRow = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

/** 전문가 메모 스레드 조회 (자사분만 — RLS) */
export async function getExpertNotes(
  expertId: string
): Promise<{ ok: true; rows: ExpertNoteRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!z.string().uuid().safeParse(expertId).success) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("expert_tenant_notes")
    .select("id, body, created_at, users (name)")
    .eq("expert_id", expertId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    return { ok: false, error: "메모를 불러오지 못했습니다. 마이그레이션 미적용일 수 있습니다." };
  }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      id: r.id,
      body: r.body,
      authorName: r.users?.name ?? "(직원)",
      createdAt: r.created_at,
    })),
  };
}

/** 메모 추가 — 수정·삭제 없이 쌓는다 (기록 성격, §14-4) */
export async function addExpertNote(
  expertId: string,
  body: string
): Promise<ProfileActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!z.string().uuid().safeParse(expertId).success) {
    return { ok: false, error: "잘못된 요청입니다." };
  }
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "메모 내용을 입력하세요." };
  if (trimmed.length > 2000) {
    return { ok: false, error: "메모는 2000자 이내로 입력하세요." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("expert_tenant_notes").insert({
    tenant_id: g.tenantId,
    expert_id: expertId,
    body: trimmed,
    created_by: g.userId,
  });
  if (error) {
    return {
      ok: false,
      error: await explainActionError(error.message, "메모 저장에 실패했습니다."),
    };
  }

  revalidatePath("/[tenantSlug]/experts", "page");
  return { ok: true };
}
