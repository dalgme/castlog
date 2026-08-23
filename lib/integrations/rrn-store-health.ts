import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { hasStoreBEnv, createStoreBClient } from "@/lib/supabase/rrn-store-b";
import { resolveEmailProvider } from "@/lib/email/provider";

export type StoreBHealth = {
  ok: boolean;
  /** 실패 분류 — 문구·대응이 다르다 (§12-9) */
  cause?: "env_missing" | "unreachable" | "auth_rejected" | "other";
  message?: string;
};

/**
 * 저장소 B(주민번호 뒷조각) 상태 점검 — 매일 크론으로 호출 (재발 방지 ①).
 *
 * 실사고(2026-08-23) 원인은 '일시정지'가 아니라 'Vercel의 접속 키 불일치'였고,
 * 전문가가 등록을 시도하기 전까지 아무도 몰랐다. 이 점검은 두 위험을 함께 막는다:
 *  - 키 불일치·키 회전 → 인증이 실제로 통과하는 조회로 매일 검증, 실패 시 경보
 *  - 무료 플랜 자동 일시정지 → 매일 접속하는 것 자체가 깨어 있게 유지(keep-alive)
 *
 * 조회는 뒷조각 '건수'만 센다(head) — 암호문에는 접근하지 않는다.
 */
export async function checkRrnStoreBHealth(): Promise<StoreBHealth> {
  if (!hasStoreBEnv()) {
    const result: StoreBHealth = {
      ok: false,
      cause: "env_missing",
      message: "RRN_STORE_B_SERVICE_KEY가 설정되지 않았습니다.",
    };
    await recordAndAlert(result);
    return result;
  }

  try {
    const storeB = createStoreBClient();
    const { error } = await storeB
      .from("rrn_fragments_back")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) throw error;
    await record({ ok: true });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    const cause: StoreBHealth["cause"] = /fetch failed|network|ENOTFOUND|ECONN|timeout/i.test(
      message
    )
      ? "unreachable"
      : /invalid api key|jwt|unauthorized|401|403/i.test(message)
        ? "auth_rejected"
        : "other";
    const result: StoreBHealth = { ok: false, cause, message: message.slice(0, 300) };
    await recordAndAlert(result);
    return result;
  }
}

/** 점검 결과를 감사로그에 남긴다 (INSERT 전용 — 이력 조회용). */
async function record(result: StoreBHealth): Promise<void> {
  if (!hasSupabaseEnv()) return;
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      tenant_id: null,
      actor_auth_user_id: null,
      actor_role: "system",
      action: result.ok ? "rrn.store_b.health_ok" : "rrn.store_b.health_failed",
      resource_type: "rrn_store_b",
      resource_id: null,
      after_data: {
        cause: result.cause ?? null,
        // 오류 메시지에는 암호문·주민번호가 없다 (연결·인증 오류 문자열)
        message: result.message ?? null,
      },
    });
  } catch {
    // 기록 실패가 점검 자체를 깨뜨리지 않게 한다
  }
}

async function recordAndAlert(result: StoreBHealth): Promise<void> {
  await record(result);
  try {
    console.error(
      `rrn store B health check failed (${result.cause}): ${result.message ?? ""}`
    );
    const to = process.env.RRN_ALERT_EMAIL;
    const provider = resolveEmailProvider();
    if (!to || !provider) return;
    const from = process.env.EMAIL_FROM ?? "CASTLOG <noreply@castlog.kr>";
    const causeLabel =
      result.cause === "env_missing"
        ? "접속 키 미설정 (Vercel 환경변수)"
        : result.cause === "unreachable"
          ? "연결 실패 — 저장소 일시정지(Paused) 또는 네트워크 장애 가능성"
          : result.cause === "auth_rejected"
            ? "인증 거부 — 접속 키 불일치(키 재발급·오입력) 가능성"
            : "기타 오류";
    await provider.send({
      from,
      to,
      subject: "[경보] 주민번호 저장소 B 상태 점검 실패",
      text:
        `주민등록번호 뒷조각 저장소(castlog-rrn-store-b) 일일 점검이 실패했습니다.\n\n` +
        `분류: ${causeLabel}\n` +
        `상세: ${result.message ?? "-"}\n\n` +
        `이 상태에서는 전문가의 주민번호 신규 등록이 실패합니다.\n` +
        `대응: Supabase 대시보드에서 저장소 B 상태(Restore 여부)를 확인하고,\n` +
        `인증 거부라면 저장소 B의 service_role 키를 다시 복사해 Vercel의\n` +
        `RRN_STORE_B_SERVICE_KEY에 저장한 뒤 재배포하세요.\n`,
    });
  } catch {
    // 경보 실패는 무시 — 감사로그에는 이미 남았다
  }
}
