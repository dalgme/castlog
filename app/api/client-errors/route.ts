import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  practiceFromUser,
  roleFromUser,
  tenantIdFromUser,
} from "@/lib/auth/tenant";
import { isMonitorActive } from "@/lib/monitoring/flags";

export const dynamic = "force-dynamic";

/**
 * 런타임 에러 접수 — app/error.tsx·global-error.tsx가 쏘는 계측 엔드포인트.
 *
 * 왜 라우트인가: 에러 바운더리는 서버 액션 호출 문맥이 아닐 수 있다(루트
 * 레이아웃까지 무너진 global-error 포함). fire-and-forget POST가 가장 튼튼하다.
 *
 * 보호 장치:
 * - 테넌트는 **JWT에서만** 읽는다(§3). 요청 본문의 테넌트 지정은 받지 않는다.
 * - 그 테넌트의 모니터링 창(feature_flags.monitor_until)이 열려 있을 때만
 *   기록한다 — 상시 수집이 아니라 테스트 세션 계측이다.
 * - 분당 상한(테넌트당)으로 에러 루프·장난 호출이 테이블을 채우는 것을 막는다.
 * - 응답은 항상 동일(202) — 기록 여부를 밖에서 구분할 수 없게 한다.
 */

const bodySchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(2000).optional(),
  digest: z.string().max(120).optional(),
  path: z.string().max(300).optional(),
  source: z.enum(["client", "global"]).default("client"),
});

/** 분당 테넌트별 기록 상한 — 에러 루프 방어 */
const MAX_PER_MINUTE = 30;

const accepted = () => NextResponse.json({ ok: true }, { status: 202 });

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) return accepted();

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return accepted();
  }

  // 세션이 있어야 어느 회사의 테스트인지 안다. 없으면 조용히 버린다 —
  // 로그인 전 공개 화면 에러까지 받으면 익명 스팸 통로가 된다.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return accepted();

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("feature_flags")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || !isMonitorActive(tenant.feature_flags)) return accepted();

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("client_error_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", oneMinuteAgo);
  if ((count ?? 0) >= MAX_PER_MINUTE) return accepted();

  await admin.from("client_error_logs").insert({
    tenant_id: tenantId,
    user_id: user.id,
    user_role: roleFromUser(user),
    path: parsed.path?.split("?")[0] ?? null,
    message: parsed.message,
    // 스택 최상단 5줄만 — 아래로 갈수록 프레임워크 내부라 해석 가치가 없다
    stack_digest: parsed.stack?.split("\n").slice(0, 5).join("\n") ?? null,
    error_digest: parsed.digest ?? null,
    source: parsed.source,
    user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    is_practice: practiceFromUser(user),
  });

  return accepted();
}
