import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { PUBLIC_LINK_PATHS } from "@/lib/routing/reserved-slugs";
import { isTenantSlugSegment } from "@/lib/routing/slug";

/** 인증 없이 접근 가능한 공개 경로 prefix (매직링크는 로그인 없이 열려야 한다) */
const PUBLIC_PATH_PREFIXES = [
  ...Object.values(PUBLIC_LINK_PATHS).map((p) => `/${p}/`),
  "/login",
  "/signup",
  "/auth",
  "/expert/login",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix)
  );
}

function isUnderPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export async function middleware(request: NextRequest) {
  // 1) 세션 갱신 (만료 토큰 리프레시)
  const { response, user, configured } = await updateSession(request);

  // 환경변수 미설정(프리뷰 배포) — 인증 게이트 비활성, 안전 통과
  if (!configured) {
    return response;
  }

  const { pathname } = request.nextUrl;

  // 2) 공개 경로는 인증·테넌트 검사 없이 통과
  if (isPublicPath(pathname)) {
    return response;
  }

  // 3) 인증 게이트 — 미로그인 시 대상별 로그인 페이지로 (레이아웃 가드와 이중 방어)
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = isUnderPath(pathname, "/expert") ? "/expert/login" : "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 3-1) 최초 로그인 비밀번호 강제 변경 (단계 30)
  //   관리자가 발급한 임시 비밀번호(must_change_password) 사용자는 변경 완료 전까지
  //   /account/password로 강제 이동한다. 로그아웃(/auth)은 공개 경로라 이미 통과.
  if (
    user.app_metadata?.must_change_password === true &&
    !isUnderPath(pathname, "/account/password")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/account/password";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 4) 플랫폼관리자 전역 경로 — 역할 불일치 시 홈으로
  if (isUnderPath(pathname, "/platform-admin")) {
    if (user.app_metadata?.role !== "platform_admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // 5) URL 슬러그 ↔ 세션 테넌트 불일치 검사
  //    슬러그는 표시용일 뿐이다. 권한 판정은 항상 JWT의 tenant_id로 하며(설계문서 3.6),
  //    여기서는 혼란 방지를 위해 올바른 슬러그 경로로 리다이렉트만 수행한다.
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first && isTenantSlugSegment(first)) {
    const sessionSlug = user.app_metadata?.tenant_slug;
    if (
      typeof sessionSlug === "string" &&
      sessionSlug.length > 0 &&
      sessionSlug !== first
    ) {
      const url = request.nextUrl.clone();
      url.pathname = `/${[sessionSlug, ...segments.slice(1)].join("/")}`;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
