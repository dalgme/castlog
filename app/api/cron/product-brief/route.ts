import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { buildProductBrief } from "@/lib/marketing/product-brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 제품 소개서 월간 갱신 — 매월 1일 02시(KST).
 *
 * 왜 매일 도는가: Vercel 크론은 UTC로만 돌고, 'KST 1일 02시'는 UTC로 보면
 * **전월 말일 17시**다. 말일은 28~31일로 달마다 달라서 cron 식으로 못 쓴다.
 * 그래서 매일 17:00 UTC에 깨어나 KST 날짜가 1일일 때만 실제로 갱신한다.
 * 헛도는 호출 29번의 비용보다, 달마다 갱신일이 어긋나는 쪽이 나쁘다.
 *
 * 소개서 본문은 제품 코드에서 생성한다(lib/marketing/product-brief.ts).
 * 사람이 따로 써 두는 자료가 아니므로 제품과 어긋날 수 없고, 여기서는 그 결과를
 * 그 달의 판으로 굳혀 저장하기만 한다 — 보는 시점마다 문구가 흔들리면 영업
 * 자료로 쓸 수 없기 때문이다.
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

  const now = new Date();
  const kstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDate();
  // 수동 호출(?force=1)은 판을 미리 만들어 확인할 때 쓴다
  const forced = request.nextUrl.searchParams.get("force") === "1";
  if (kstDay !== 1 && !forced) {
    return NextResponse.json({ ok: true, skipped: "not_first_of_month_kst" });
  }

  const brief = buildProductBrief(now);
  const admin = createAdminClient();
  const { error } = await admin.from("product_brief_editions").upsert(
    {
      edition: brief.edition,
      content: brief as unknown as Json,
      generated_at: now.toISOString(),
    },
    { onConflict: "edition" }
  );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, edition: brief.edition });
}
