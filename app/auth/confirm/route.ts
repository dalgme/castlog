import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { sanitizeNextPath } from "@/lib/auth/schemas";

/**
 * 이메일 링크 착지점 (token_hash 방식) — /auth/confirm
 *
 * ── 왜 /auth/callback으로는 안 되는가 ──────────────────────────────────────
 * /auth/callback은 `?code=`(PKCE)를 기다린다. 그런데 관리자가 발급하는 링크
 * (admin.generateLink)에는 PKCE를 걸 수 없다 — PKCE는 브라우저가 검증자를
 * 들고 있어야 하는데, 계정을 만드는 시점에는 그 사람의 브라우저가 없다.
 *
 * 그래서 그 링크는 **암시적 방식**으로 떨어진다: Supabase가 토큰을 확인한 뒤
 * `…/reset-password#access_token=…` 처럼 **URL 프래그먼트(#)** 에 토큰을 실어
 * 보낸다. 프래그먼트는 브라우저가 서버로 보내지 않는다. 그래서 서버 라우트인
 * /auth/callback은 아무것도 못 받고 `code`가 없다고 판단해 로그인 화면으로
 * 되돌린다 — 실제로 그 증상이 났다("링크를 누르면 로그인 화면으로 간다").
 *
 * ── 그래서 이 라우트 ────────────────────────────────────────────────────────
 * generateLink가 함께 돌려주는 `hashed_token`으로 **우리 도메인 주소를 직접
 * 만든다.** 여기서 verifyOtp로 확인하면 세션이 쿠키에 실려 서버·클라이언트
 * 양쪽에서 그대로 쓰인다. 프래그먼트를 볼 일이 없다.
 *
 * 덤이 하나 더 있다. 메일의 링크가 castlog.kr을 가리키므로 **Supabase의
 * Redirect URLs 허용 목록에 더 이상 의존하지 않는다.** 직전에 겪은 사고
 * (허용 목록에 없어 Site URL로 조용히 바꿔치기됨)가 구조적으로 사라진다.
 */

/** 이 경로로 확인할 수 있는 링크 종류만 연다 — 넓힐 이유가 없다 */
const ALLOWED_TYPES = ["recovery", "invite", "email"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

function isAllowedType(value: string | null): value is AllowedType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = sanitizeNextPath(searchParams.get("next")) ?? "/";

  if (tokenHash && isAllowedType(type) && hasSupabaseEnv()) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 만료·재사용·위조 — 어느 쪽인지 링크를 누른 사람에게 구분해 알려 줄 이유가
  // 없다. 다시 받는 길로 보낸다.
  return NextResponse.redirect(`${origin}/forgot-password?error=link_expired`);
}
