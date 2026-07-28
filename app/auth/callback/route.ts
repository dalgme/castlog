import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { sanitizeNextPath } from "@/lib/auth/schemas";

/**
 * Supabase Auth 코드 교환 콜백 — 초대·비밀번호 재설정 등 이메일 링크 착지점.
 * code를 세션으로 교환한 뒤 내부 경로로만 리다이렉트한다.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next")) ?? "/";

  if (code && hasSupabaseEnv()) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
