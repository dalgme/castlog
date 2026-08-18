import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { expireOverdueEngagements } from "@/lib/integrations/engagement-lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 응답 기한이 지난 섭외요청 만료 처리 (Vercel Cron — vercel.json 참조).
 *
 * 인증은 session-notices와 동일: CRON_SECRET이 있으면 Bearer만, 없으면
 * Vercel Cron 헤더만 통과시킨다.
 *
 * 이 엔드포인트는 '기한이 이미 지난 건'만 처리하므로 호출 자체로 뭔가를 앞당겨
 * 만료시키지 않는다.
 */
export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : request.headers.get("x-vercel-cron") !== null;

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await expireOverdueEngagements();
  return NextResponse.json({ ok: true, ...result });
}
