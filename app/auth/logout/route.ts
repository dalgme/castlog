import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { sanitizeNextPath } from "@/lib/auth/schemas";

/**
 * 로그아웃 — POST 전용(프리페치로 인한 의도치 않은 로그아웃 방지).
 * redirectTo 폼 필드로 복귀 경로를 지정할 수 있다(내부 경로만, 오픈 리다이렉트 차단).
 * 지정이 없으면 역할에 맞는 로그인 화면으로 보낸다.
 */
export async function POST(request: NextRequest) {
  let loginPath = "/login";

  // 세션을 지우기 전에 읽어야 한다 (signOut 이후에는 role을 알 수 없다)
  const formData = await request.formData().catch(() => null);
  const requested = sanitizeNextPath(formData?.get("redirectTo"));

  if (hasSupabaseEnv()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.app_metadata?.role === "expert") {
      loginPath = "/expert/login";
    }
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL(requested ?? loginPath, request.url), {
    status: 303,
  });
}
