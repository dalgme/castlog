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
import { maskRrnInText } from "@/lib/crypto/rrn-mask";

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

/** 요청 본문 선차단 상한 — zod는 파싱 뒤에만 작동한다 (리뷰 6a) */
const MAX_BODY_BYTES = 16 * 1024;

/** 분당 사용자별 부상한 — 한 사용자의 에러 루프가 테넌트 예산을 다 먹지 않게 (리뷰 6b) */
const MAX_PER_MINUTE_PER_USER = 10;

/**
 * 마스킹 필터 — 로그 파이프라인 최전단 (§5, 리뷰 1).
 * 예외 문구에 무엇이 실릴지 통제할 수 없으므로 주민번호 패턴에 더해
 * 휴대폰·계좌로 보이는 긴 숫자열도 가린다.
 */
function maskSensitive(text: string): string {
  return maskRrnInText(text)
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, "01*-****-****")
    .replace(/\b\d{11,16}\b/g, (m) => `${m.slice(0, 3)}${"*".repeat(m.length - 3)}`);
}

const accepted = () => NextResponse.json({ ok: true }, { status: 202 });

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) return accepted();

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return accepted();
  }

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
  const [{ count: tenantCount }, { count: userCount }] = await Promise.all([
    admin
      .from("client_error_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", oneMinuteAgo),
    admin
      .from("client_error_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneMinuteAgo),
  ]);
  if ((tenantCount ?? 0) >= MAX_PER_MINUTE) return accepted();
  if ((userCount ?? 0) >= MAX_PER_MINUTE_PER_USER) return accepted();

  await admin.from("client_error_logs").insert({
    tenant_id: tenantId,
    user_id: user.id,
    user_role: roleFromUser(user),
    path: maskSensitive(parsed.path?.split("?")[0] ?? "") || null,
    message: maskSensitive(parsed.message),
    // 스택 최상단 5줄만 — 아래로 갈수록 프레임워크 내부라 해석 가치가 없다
    stack_digest: parsed.stack
      ? maskSensitive(parsed.stack.split("\n").slice(0, 5).join("\n"))
      : null,
    error_digest: parsed.digest ?? null,
    source: parsed.source,
    user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    is_practice: practiceFromUser(user),
  });

  return accepted();
}
