import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { dispatchDueSessionNotices } from "@/lib/integrations/session-notices";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 세션 안내문자 예약 발송 실행기 (Vercel Cron — vercel.json 참조).
 *
 * 인증:
 *  - CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <CRON_SECRET>`만 허용한다.
 *    (Vercel Cron은 이 헤더를 자동으로 붙인다)
 *  - 미설정 환경에서는 Vercel Cron 요청(x-vercel-cron 헤더)만 통과시킨다.
 *
 * 이 엔드포인트는 '예약 시각이 지난 건'만 처리하므로, 호출 자체로 앞당겨 보내지지
 * 않는다. 그래도 운영에서는 CRON_SECRET을 설정하는 것을 권장한다.
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

  const result = await dispatchDueSessionNotices();
  return NextResponse.json({ ok: true, ...result });
}
