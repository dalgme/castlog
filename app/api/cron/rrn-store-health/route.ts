import { NextResponse, type NextRequest } from "next/server";

import { checkRrnStoreBHealth } from "@/lib/integrations/rrn-store-health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 저장소 B(주민번호 뒷조각) 일일 상태 점검 (Vercel Cron — vercel.json 참조).
 * 키 불일치·일시정지를 등록 시도 전에 발견하고(경보), 접속 자체가 무료 플랜
 * 자동 일시정지를 막는 keep-alive 역할을 한다.
 *
 * 인증은 다른 크론과 동일: CRON_SECRET이 있으면 Bearer만, 없으면
 * Vercel Cron 헤더만 통과시킨다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : request.headers.get("x-vercel-cron") !== null;

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await checkRrnStoreBHealth();
  // 실패해도 200 — 크론 재시도 폭주 대신 경보·감사로그로 처리한다
  return NextResponse.json(result);
}
