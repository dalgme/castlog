import "server-only";

import QRCode from "qrcode";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type VisibleFields = {
  specialty: boolean;
  region: boolean;
  career_years: boolean;
  bio: boolean;
  portfolio: boolean;
};

export const DEFAULT_VISIBLE_FIELDS: VisibleFields = {
  specialty: true,
  region: true,
  career_years: true,
  bio: true,
  portfolio: true,
};

export type PortfolioItem = {
  id: string;
  title: string;
  role: string | null;
  orgName: string | null;
  period: string | null;
  summary: string | null;
  links: string[];
  isPublic: boolean;
  sortOrder: number;
};

export type PublicProfileView = {
  handle: string;
  name: string;
  headline: string | null;
  intro: string | null;
  specialty: string | null;
  region: string | null;
  careerYears: number | null;
  bio: string | null;
  visibleFields: VisibleFields;
  portfolio: PortfolioItem[];
};

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

export function coerceVisibleFields(raw: unknown): VisibleFields {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    specialty: v.specialty !== false,
    region: v.region !== false,
    career_years: v.career_years !== false,
    bio: v.bio !== false,
    portfolio: v.portfolio !== false,
  };
}

/** QR 코드 data URL 생성(서버). 인쇄·명함용으로 오차보정 M, 여백 최소. */
export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#0B1D3A", light: "#FFFFFF" },
  });
}

/**
 * 공개 프로필 해석(/p/{handle}) — service_role로 읽어 is_public + visible_fields만 노출.
 * 조회수는 best-effort 증가. 민감정보는 절대 포함하지 않는다.
 */
export async function resolvePublicProfile(
  handle: string
): Promise<PublicProfileView | null> {
  if (!hasSupabaseEnv()) return null;
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("expert_public_profiles")
    .select(
      "id, expert_id, handle, is_public, headline, intro, visible_fields, view_count"
    )
    .eq("handle", handle)
    .maybeSingle();

  if (!profile || !profile.is_public) return null;

  const visible = coerceVisibleFields(profile.visible_fields);

  const { data: expert } = await admin
    .from("experts")
    .select("name, specialty, region, career_years, bio")
    .eq("id", profile.expert_id)
    .maybeSingle();
  if (!expert) return null;

  // 이용 중지 전문가의 공개 명함은 내린다 (관리모드 중지 — 허위 프로필·본인
  // 요청 탈퇴가 중지의 대표 사유다). 별도 조회 + 오류 통과 — is_active 컬럼
  // 미적용 환경에서 /p 전체가 죽지 않게 (§14-10 부재 폴백)
  {
    const { data: activeRow, error: activeError } = await admin
      .from("experts")
      .select("is_active")
      .eq("id", profile.expert_id)
      .maybeSingle();
    if (!activeError && activeRow && activeRow.is_active === false) return null;
  }

  let portfolio: PortfolioItem[] = [];
  if (visible.portfolio) {
    const { data: items } = await admin
      .from("expert_portfolio_items")
      .select("id, title, role, org_name, period, summary, links, is_public, sort_order")
      .eq("expert_id", profile.expert_id)
      .eq("is_public", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    portfolio = (items ?? []).map((it) => ({
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
  }

  // 조회수 증가(best-effort — read-then-write, 카운터라 경합 허용)
  await admin
    .from("expert_public_profiles")
    .update({ view_count: (profile.view_count ?? 0) + 1 })
    .eq("id", profile.id)
    .then(() => undefined, () => undefined);

  return {
    handle: profile.handle,
    name: expert.name,
    headline: profile.headline,
    intro: profile.intro,
    specialty: visible.specialty ? expert.specialty : null,
    region: visible.region ? expert.region : null,
    careerYears: visible.career_years ? expert.career_years : null,
    bio: visible.bio ? expert.bio : null,
    visibleFields: visible,
    portfolio,
  };
}
