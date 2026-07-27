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
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix)
  );
}

export async function middleware(request: NextRequest) {
  // 1) 세션 갱신 (만료 토큰 리프레시)
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;

  // 2) 공개 경로는 인증·테넌트 검사 없이 통과
  if (isPublicPath(pathname)) {
    return response;
  }

  // 3) URL 슬러그 ↔ 세션 테넌트 불일치 검사
  //    슬러그는 표시용일 뿐이다. 권한 판정은 항상 JWT의 tenant_id로 하며(설계문서 3.6),
  //    여기서는 혼란 방지를 위해 올바른 슬러그 경로로 리다이렉트만 수행한다.
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first && isTenantSlugSegment(first)) {
    const sessionSlug = user?.app_metadata?.tenant_slug;
    if (
      user &&
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
