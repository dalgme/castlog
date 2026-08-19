import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import { PUBLIC_LINK_PATHS } from "@/lib/routing/reserved-slugs";
import { isTenantSlugSegment } from "@/lib/routing/slug";

/**
 * 인증 없이 접근 가능한 공개 경로 prefix.
 *
 * 판단 기준은 하나다 — **로그인하지 않은 사람이 열어야 하는 화면인가.**
 * 매직링크(섭외 동의·서류 제출)뿐 아니라, 아직 계정이 없는 사람(도입 문의),
 * 로그인을 못 하는 사람(비밀번호 찾기), 계정과 무관한 사람(약관·공개 프로필)이
 * 여기 해당한다. 이 목록에서 빠지면 그 화면은 로그인 페이지로 튕겨 나가고,
 * 사용자에게는 '갑자기 안 된다'로 보인다.
 *
 * 새 공개 화면을 만들면 반드시 여기에 함께 추가한다.
 */
const PUBLIC_PATH_PREFIXES = [
  ...Object.values(PUBLIC_LINK_PATHS).map((p) => `/${p}/`),
  "/login",
  "/signup",
  "/auth",
  "/expert/login",
  // 계정이 없는 사람이 여는 화면 — 도입 문의·체험 신청(기업회원 가입 입구)
  "/contact",
  // 로그인을 못 하는 사람이 여는 화면 — 여기서 막으면 복구 경로가 사라진다
  "/forgot-password",
  "/reset-password",
  // 임직원 가입 요청 링크 — 아직 계정이 없는 사람이 연다
  "/join/",
  // 약관·개인정보 — 법적 고지는 누구나 볼 수 있어야 한다
  "/legal/",
  // 전문가 공개 프로필·QR — 명함에 찍히는 주소다
  "/p/",
  // 제품 소개서 — 도입을 검토하는 사람이 계정 없이 여는 자료
  "/product-brief",
  // 공개 화면(섭외 동의·수락서 등)에 박히는 회사 로고. 경로 자체가 tenantId만
  // 받고 로고 바이트만 내보낸다 — 인증을 요구하면 그 화면에서 로고가 깨진다.
  "/api/tenant-logo/",
  // 크론 실행기 — 세션이 없다. 자체 시크릿(CRON_SECRET)으로 인증한다.
  "/api/cron/",
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

  // 2-1) 기업 전용 진입 주소 — /{tenant-slug} 딱 한 칸.
  //      그 아래(/{slug}/…)는 전부 업무 화면이라 인증이 필요하지만, 루트 한 칸은
  //      회사 이름·로고와 '들어가는 문'만 보여 주는 공개 화면이다. 회사 주소를
  //      눌렀는데 로그인 화면으로 튕기면 그건 '우리 회사 주소'가 아니다.
  //      화면 자체가 조직 정보를 내보내지 않으므로 열어도 안전하다.
  {
    const parts = pathname.split("/").filter(Boolean);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only && isTenantSlugSegment(only)) {
      return response;
    }
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

  // 4) 플랫폼관리자 전역 경로 — 역할이 아니면 진단 화면으로.
  //    홈으로 되돌려보내면 '눌렀는데 아무 일도 안 일어난다'만 남는다.
  //    왜 못 들어가는지 보여 주는 자리로 보낸다.
  if (isUnderPath(pathname, "/platform-admin")) {
    if (user.app_metadata?.role !== "platform_admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/account/admin-mode";
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
