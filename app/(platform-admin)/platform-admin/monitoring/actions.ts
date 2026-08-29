"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { roleFromUser } from "@/lib/auth/tenant";
import { parseMonitorUntil } from "@/lib/monitoring/flags";
import type { Json } from "@/lib/supabase/database.types";
import { generateText, isAiConfigured } from "@/lib/ai/client";
import { maskRrnInText } from "@/lib/crypto/rrn-mask";

/**
 * 실시간 사용자 테스트 모니터링 — 관리모드 서버 액션 (기획 2026-08-29)
 *
 * 모니터링 창은 tenants.feature_flags.monitor_until(ISO 시각)으로 표현한다.
 * 시각을 넣으면 켜짐, 키를 지우면 꺼짐. 시각이 지나면 저절로 닫힌다 —
 * 켜 두고 잊어도 상시 수집으로 눌러앉지 않는다.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

/** 현재 세션이 플랫폼관리자인지 확인 (JWT app_metadata 기준) */
async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string; role: string } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = roleFromUser(user);
  if (!user || role !== "platform_admin") {
    return { ok: false, error: "플랫폼관리자 권한이 필요합니다." };
  }
  return { ok: true, userId: user.id, role };
}

/** 켤 수 있는 창 길이(시간) — 화면 버튼과 서버 검증이 같은 목록을 쓴다 */
export type MonitorHours = 4 | 12 | 24;
const ALLOWED_HOURS: MonitorHours[] = [4, 12, 24];

/**
 * 기업별 모니터링 창 켜기/끄기.
 * hours를 넘기면 지금부터 그 시간만큼 켜고, null이면 끈다.
 */
export async function setTenantMonitoring(
  tenantId: string,
  hours: MonitorHours | null
): Promise<ActionResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (hours !== null && !ALLOWED_HOURS.includes(hours)) {
    return { ok: false, error: "허용되지 않는 창 길이입니다." };
  }

  const until =
    hours === null
      ? null
      : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();

  // feature_flags는 여러 주체(모듈 승인·라이트 토글)가 같이 쓴다 —
  // setExpertsLite와 동일한 updated_at 낙관적 잠금으로 병합 경합을 막는다.
  let saved = false;
  let priorUntil: string | null = null;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("feature_flags, updated_at")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return { ok: false, error: "테넌트 정보를 확인할 수 없습니다." };
    priorUntil = parseMonitorUntil(tenant.feature_flags);

    const priorFlags: Record<string, Json | undefined> =
      tenant.feature_flags !== null &&
      typeof tenant.feature_flags === "object" &&
      !Array.isArray(tenant.feature_flags)
        ? (tenant.feature_flags as Record<string, Json | undefined>)
        : {};
    // 끌 때는 키 자체를 지운다 — 남겨 두면 "지난 시각"과 "끈 것"이 섞인다
    const restFlags = Object.fromEntries(
      Object.entries(priorFlags).filter(([k]) => k !== "monitor_until")
    );
    const nextFlags =
      until === null ? restFlags : { ...restFlags, monitor_until: until };

    let updateQuery = admin
      .from("tenants")
      .update({
        feature_flags: nextFlags as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);
    updateQuery = tenant.updated_at
      ? updateQuery.eq("updated_at", tenant.updated_at)
      : updateQuery.is("updated_at", null);
    const { data: updated, error } = await updateQuery.select("id");
    if (error) {
      return {
        ok: false,
        error: "저장에 실패했습니다 (시스템 오류). 잠시 후 다시 시도해 주세요.",
      };
    }
    saved = (updated ?? []).length > 0;
  }
  if (!saved) {
    return {
      ok: false,
      error: "다른 설정 변경과 겹쳤습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: until ? "tenant.monitor_on" : "tenant.monitor_off",
    resource_type: "tenant",
    resource_id: tenantId,
    before_data: { monitor_until: priorUntil },
    after_data: { monitor_until: until },
  });

  revalidatePath("/platform-admin/monitoring", "page");
  revalidatePath("/platform-admin/monitoring/[tenantId]", "page");
  return { ok: true };
}

/** v1.0.0 — 에러 해석 프롬프트 (CLAUDE.md §14-1 버전 관리) */
const MONITOR_INTERPRET_PROMPT_VERSION = "v1.0.0";

const INTERPRET_SYSTEM = `당신은 B2B SaaS '캐스트로그'(Next.js 14 App Router + Supabase)의 운영 엔지니어를 돕는 도우미입니다.
런타임 에러 기록 한 건을 받아 한국어로 해석합니다.

규칙:
- 출력은 세 부분: ① 무엇이 잘못됐는지 한 문장 ② 추정 원인 분류(권한/RLS 거부 · 상태 경합 · 코드 결함 · 네트워크/외부 서비스) ③ 지금 테스트 중인 사용자에게 안내할 다음 행동 한 문장.
- 6줄을 넘기지 마세요.
- 확실하지 않으면 확실하지 않다고 말하세요. 스택에 없는 원인을 지어내지 마세요.
- 이 해석은 참고용 설명일 뿐 수정 판단의 근거가 아닙니다.`;

/**
 * 에러 기록 AI 해석 — 설명·문장화만 (§14-1). 해석 결과는 저장하지 않고
 * 화면에만 보여 준다. 조회 자체는 audit_logs에 남긴다.
 */
export async function interpretErrorLog(
  errorId: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "서버 설정이 완료되지 않았습니다." };
  }
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isAiConfigured()) {
    return { ok: false, error: "AI가 설정되지 않았습니다 (ANTHROPIC_API_KEY)." };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("client_error_logs")
    .select("id, tenant_id, path, message, stack_digest, error_digest, source, created_at")
    .eq("id", errorId)
    .maybeSingle();
  if (!row) return { ok: false, error: "에러 기록을 찾을 수 없습니다." };

  // 외부 API로 나가기 전 이중 마스킹 (§5 — 저장 시점에도 걸지만 최전단 원칙)
  const result = await generateText({
    system: INTERPRET_SYSTEM,
    user: maskRrnInText(
      [
        `발생 화면: ${row.path ?? "(모름)"}`,
        `발생 지점: ${row.source}`,
        `메시지: ${row.message}`,
        row.error_digest ? `digest: ${row.error_digest}` : null,
        row.stack_digest ? `스택 상단:\n${row.stack_digest}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join("\n")
    ),
    maxTokens: 400,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: row.tenant_id,
    actor_auth_user_id: gate.userId,
    actor_role: gate.role,
    action: "monitor.error_interpret",
    resource_type: "client_error_log",
    resource_id: row.id,
    after_data: { prompt_version: MONITOR_INTERPRET_PROMPT_VERSION },
  });

  return { ok: true, text: result.text };
}
