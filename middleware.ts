import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * 1) Supabase 세션 갱신 (만료 토큰 리프레시)
 * 2) 라우팅·권한 검사는 단계 3 이후 확장
 */
export async function middleware(request: NextRequest) {
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    /*
     * 다음을 제외한 모든 요청 경로에서 실행:
     * - _next/static, _next/image (정적 자원)
     * - favicon.ico, 이미지·폰트 파일
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
