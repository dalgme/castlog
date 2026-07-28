import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import { roleFromUser, type UserRole } from "./tenant";

/**
 * 세션 가드 (설계문서 3.1 — 5단계 권한 체계)
 *
 * 미들웨어가 1차로 인증을 걸러내지만, 레이아웃·페이지에서 이 모듈로
 * 한 번 더 검증한다(이중 방어). 권한 판정은 항상 JWT app_metadata 기준.
 *
 * 환경변수 미설정(프리뷰 배포) 시에는 null을 반환하고 통과시킨다 —
 * 미들웨어의 안전 통과 정책과 동일한 기준(hasSupabaseEnv).
 */

/** 인증 서버 검증(getUser)을 거친 현재 세션 사용자. 미로그인·프리뷰면 null. */
export async function getSessionUser(): Promise<User | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** 역할·테넌트에 따른 로그인 후 기본 이동 경로 */
export function postLoginPath(user: User): string {
  const role = roleFromUser(user);
  if (role === "platform_admin") return "/platform-admin";
  if (role === "expert") return "/expert";
  const slug = user.app_metadata?.tenant_slug;
  if (typeof slug === "string" && slug.length > 0) {
    return `/${slug}/dashboard`;
  }
  return "/";
}

/** 로그인 필수. 미로그인 시 로그인 페이지로 리다이렉트. 프리뷰(환경변수 미설정)는 통과. */
export async function requireUser(loginPath = "/login"): Promise<User | null> {
  if (!hasSupabaseEnv()) return null;
  const user = await getSessionUser();
  if (!user) redirect(loginPath);
  return user;
}

/** 특정 역할 필수. 역할 불일치 시 해당 사용자의 기본 경로로 리다이렉트. */
export async function requireRole(
  roles: readonly UserRole[],
  loginPath = "/login"
): Promise<User | null> {
  if (!hasSupabaseEnv()) return null;
  const user = await requireUser(loginPath);
  if (!user) return null;
  const role = roleFromUser(user);
  if (!role || !roles.includes(role)) {
    redirect(postLoginPath(user));
  }
  return user;
}
