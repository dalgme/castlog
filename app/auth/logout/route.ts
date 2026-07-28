import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/** 로그아웃 — POST 전용(프리페치로 인한 의도치 않은 로그아웃 방지). */
export async function POST(request: NextRequest) {
  let loginPath = "/login";

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

  return NextResponse.redirect(new URL(loginPath, request.url), { status: 303 });
}
