"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { buildPublicLink } from "@/lib/routing/links";
import {
  coerceVisibleFields,
  generateQrDataUrl,
  isValidHandle,
  DEFAULT_VISIBLE_FIELDS,
  type PortfolioItem,
  type VisibleFields,
} from "@/lib/experts/public-profile";

export type ProfileContext = {
  handle: string;
  suggestedHandle: string;
  isPublic: boolean;
  headline: string;
  intro: string;
  visibleFields: VisibleFields;
  viewCount: number;
  hasProfile: boolean;
  publicUrl: string | null;
  qrDataUrl: string | null;
  portfolio: PortfolioItem[];
};

async function currentExpert(): Promise<{ id: string; name: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: expert } = await supabase
    .from("experts")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return expert ? { id: expert.id, name: expert.name } : null;
}

function randomHandle(): string {
  return `expert-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function safePublicUrl(handle: string): string | null {
  try {
    return buildPublicLink("publicProfile", handle);
  } catch {
    return null;
  }
}

export async function getPublicProfileContext(): Promise<ProfileContext> {
  const suggested = randomHandle();
  const empty: ProfileContext = {
    handle: "",
    suggestedHandle: suggested,
    isPublic: false,
    headline: "",
    intro: "",
    visibleFields: DEFAULT_VISIBLE_FIELDS,
    viewCount: 0,
    hasProfile: false,
    publicUrl: null,
    qrDataUrl: null,
    portfolio: [],
  };
  if (!hasSupabaseEnv()) return empty;
  const supabase = createClient();
  const expert = await currentExpert();
  if (!expert) return empty;

  const [{ data: profile }, { data: items }] = await Promise.all([
    supabase
      .from("expert_public_profiles")
      .select("handle, is_public, headline, intro, visible_fields, view_count")
      .eq("expert_id", expert.id)
      .maybeSingle(),
    supabase
      .from("expert_portfolio_items")
      .select("id, title, role, org_name, period, summary, links, is_public, sort_order")
      .eq("expert_id", expert.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);

  const portfolio: PortfolioItem[] = (items ?? []).map((it) => ({
    id: it.id,
    title: it.title,
    role: it.role,
    orgName: it.org_name,
    period: it.period,
    summary: it.summary,
    links: it.links ?? [],
    isPublic: it.is_public,
    sortOrder: it.sort_order,
  }));

  if (!profile) return { ...empty, portfolio };

  const publicUrl = safePublicUrl(profile.handle);
  const qrDataUrl = publicUrl ? await generateQrDataUrl(publicUrl) : null;

  return {
    handle: profile.handle,
    suggestedHandle: suggested,
    isPublic: profile.is_public,
    headline: profile.headline ?? "",
    intro: profile.intro ?? "",
    visibleFields: coerceVisibleFields(profile.visible_fields),
    viewCount: profile.view_count,
    hasProfile: true,
    publicUrl,
    qrDataUrl,
    portfolio,
  };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const saveSchema = z.object({
  handle: z.string().trim().toLowerCase(),
  isPublic: z.boolean(),
  headline: z.string().trim().max(60).optional(),
  intro: z.string().trim().max(1000).optional(),
  visibleFields: z.object({
    specialty: z.boolean(),
    region: z.boolean(),
    career_years: z.boolean(),
    bio: z.boolean(),
    portfolio: z.boolean(),
  }),
});

export async function savePublicProfile(
  input: z.input<typeof saveSchema>
): Promise<ActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const data = parsed.data;
  if (!isValidHandle(data.handle)) {
    return {
      ok: false,
      error: "공개 주소는 영문 소문자·숫자·하이픈 3~40자로 입력하세요.",
    };
  }

  const supabase = createClient();
  const expert = await currentExpert();
  if (!expert) return { ok: false, error: "로그인이 필요합니다." };

  const { error } = await supabase.from("expert_public_profiles").upsert(
    {
      expert_id: expert.id,
      handle: data.handle,
      is_public: data.isPublic,
      headline: data.headline || null,
      intro: data.intro || null,
      visible_fields: data.visibleFields as never,
    },
    { onConflict: "expert_id" }
  );
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "이미 사용 중인 공개 주소입니다. 다른 주소를 입력하세요." };
    }
    return { ok: false, error: "저장에 실패했습니다." };
  }

  revalidatePath("/expert/public-profile");
  return { ok: true };
}

const itemSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력하세요.").max(120),
  role: z.string().trim().max(80).optional(),
  orgName: z.string().trim().max(120).optional(),
  period: z.string().trim().max(60).optional(),
  summary: z.string().trim().max(1000).optional(),
  links: z.array(z.string().trim().url("링크 형식을 확인하세요.")).max(10).optional(),
  isPublic: z.boolean(),
});

export async function upsertPortfolioItem(
  id: string | null,
  input: z.input<typeof itemSchema>
): Promise<ActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const data = parsed.data;

  const supabase = createClient();
  const expert = await currentExpert();
  if (!expert) return { ok: false, error: "로그인이 필요합니다." };

  const row = {
    expert_id: expert.id,
    title: data.title,
    role: data.role || null,
    org_name: data.orgName || null,
    period: data.period || null,
    summary: data.summary || null,
    links: (data.links ?? []).filter(Boolean),
    is_public: data.isPublic,
  };

  const query = id
    ? supabase.from("expert_portfolio_items").update(row).eq("id", id)
    : supabase.from("expert_portfolio_items").insert(row);
  const { error } = await query;
  if (error) return { ok: false, error: "저장에 실패했습니다." };

  revalidatePath("/expert/public-profile");
  return { ok: true };
}

export async function deletePortfolioItem(id: string): Promise<ActionResult> {
  if (!hasSupabaseEnv()) return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  const supabase = createClient();
  const { error } = await supabase.from("expert_portfolio_items").delete().eq("id", id);
  if (error) return { ok: false, error: "삭제에 실패했습니다." };
  revalidatePath("/expert/public-profile");
  return { ok: true };
}
