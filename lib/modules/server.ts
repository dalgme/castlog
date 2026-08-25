import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/auth/session";
import { tenantIdFromUser } from "@/lib/auth/tenant";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  DEFAULT_MODULES,
  parseExpertsLite,
  parseModuleFlags,
  type ModuleFlags,
  type ModuleKey,
} from "./modules";

/**
 * 현재 세션 테넌트의 모듈 활성 여부 (CLAUDE.md 1-2).
 * tenant_id는 JWT app_metadata에서만 읽는다. 프리뷰(환경변수 미설정)·전역
 * 계정(플랫폼관리자 초기 상태 등)은 기본값(전부 활성)을 돌려준다.
 */
export async function getTenantModules(): Promise<ModuleFlags> {
  if (!hasSupabaseEnv()) return { ...DEFAULT_MODULES };

  const user = await getSessionUser();
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return { ...DEFAULT_MODULES };

  const supabase = createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();

  return parseModuleFlags(tenant?.feature_flags);
}

/**
 * 현재 세션 테넌트의 전문가 섭외 라이트 모드 여부.
 * 미설정·프리뷰·전역 계정은 false(풀 기능) — 기존 테넌트에 영향이 없다.
 */
export async function isExpertsLite(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;

  const user = await getSessionUser();
  const tenantId = tenantIdFromUser(user);
  if (!tenantId) return false;

  const supabase = createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();

  return parseExpertsLite(tenant?.feature_flags);
}

/**
 * 테넌트 지정 라이트 모드 판정 — 발송 헬퍼(sendEngagementSms/Email)처럼
 * tenantId를 이미 들고 있는 서버 전용 경로에서 쓴다. 조회 실패 시 false를
 * 돌려 기존 동작(발송)을 유지한다 — 판정 오류가 일반 테넌트의 발송을
 * 끊어서는 안 된다.
 */
export async function isTenantExpertsLite(tenantId: string): Promise<boolean> {
  if (!hasSupabaseEnv() || !tenantId) return false;
  try {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags")
      .eq("id", tenantId)
      .maybeSingle();
    return parseExpertsLite(tenant?.feature_flags);
  } catch {
    return false;
  }
}

/**
 * 모듈 게이트 — 네비게이션 숨김만으로는 불충분하다(URL 직접 접근 가능).
 * 모듈 소속 페이지·서버 액션은 반드시 이 가드를 거친다.
 *
 * 걸린 사람은 **자기 대시보드**로 보낸다. 예전 기본값 "/"는 로그인한 직원을
 * 마케팅 랜딩에 떨어뜨렸다 — 업무 화면에서 링크를 눌렀는데 홍보 페이지가
 * 나오면 로그아웃된 줄 알게 된다.
 */
export async function requireModule(
  moduleKey: ModuleKey,
  fallbackPath?: string
): Promise<void> {
  if (!hasSupabaseEnv()) return; // 프리뷰 — 게이트 비활성
  const modules = await getTenantModules();
  if (!modules[moduleKey]) {
    if (fallbackPath) redirect(fallbackPath);
    const user = await getSessionUser();
    const slug = user?.app_metadata?.tenant_slug;
    redirect(typeof slug === "string" && slug ? `/${slug}/dashboard` : "/");
  }
}
