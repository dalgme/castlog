// ============================================================================
// 주민등록번호 복호화 서비스 (Phase 2.3 스캐폴드 — 미배포)
// 설계: docs/decisions/rrn-phase2-secure-subsystem.md
//
// 이 Edge Function은 플랫폼 전체에서 **유일한 복호화 주체**다. 메인 앱(Next.js)은
// 복호화 능력이 없고, 이 서비스에 **1건 단위 서명 요청**만 보낸다. 서비스는
//   1) 요청이 승인된 지급 결재(tax_access_requests)에 연결됐는지 검증
//   2) 시간당 상한/프로젝트당 2회 한도/허니토큰을 판정
//   3) 앞조각(메인 DB) + 뒷조각(저장소 B) 결합, 조회 비밀번호에서 유도한 키로 복호화
//   4) 지급명세서 파일 생성(기본 경로) 또는 마스킹 확인값 반환
//   5) tax_access_logs 기록 + 전문가 즉시 통지
// 를 수행하고 평문은 메모리에서만 다루며 즉시 폐기한다.
//
// ⚠️ 아직 배포하지 않는다. 저장소 B(별도 Supabase 프로젝트)가 프로비저닝되고
//    아래 시크릿이 설정된 뒤에만 배포·활성화한다.
//    필요한 시크릿(Edge Function secrets):
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (메인 DB — 앞조각·요청·로그)
//      RRN_STORE_B_URL / RRN_STORE_B_SERVICE_KEY   (저장소 B — 뒷조각)
//      RRN_SERVICE_SHARED_SECRET                   (메인 앱↔서비스 상호 인증)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
// Argon2id — 배포 시 핀 고정. 조회 비밀번호 → 래핑키 유도(솔트·파라미터는 레코드 저장).
import { hash as argon2Verify } from "jsr:@rabbit-company/argon2id";

const RATE_LIMIT_PER_HOUR = 10;
const PROJECT_LIMIT = 2;

type DecryptRequest = {
  requestId: string; // tax_access_requests.id (1요청 = 1건)
  lookupPassword: string; // 조회 비밀번호 — 저장하지 않는다(요청 바디로만 수신)
};

function mainDb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
function storeB() {
  return createClient(
    Deno.env.get("RRN_STORE_B_URL")!,
    Deno.env.get("RRN_STORE_B_SERVICE_KEY")!
  );
}

/** 메인 앱↔서비스 상호 인증 (서명 헤더). 실패 시 거부. */
function assertServiceAuth(req: Request): boolean {
  const provided = req.headers.get("x-rrn-service-secret");
  const expected = Deno.env.get("RRN_SERVICE_SHARED_SECRET");
  return Boolean(expected) && provided === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!assertServiceAuth(req)) return new Response("Unauthorized", { status: 401 });

  let body: DecryptRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (!body.requestId || !body.lookupPassword) {
    return new Response("Bad Request", { status: 400 });
  }

  const db = mainDb();

  // (1) 요청이 승인된 지급 결재에 연결됐는지 — 연결 없으면 거부(§8)
  const { data: request } = await db
    .from("tax_access_requests")
    .select(
      "id, tenant_id, project_id, expert_id, approval_id, reason, status, reauth_at, is_over_limit, over_limit_approved_by, requested_by"
    )
    .eq("id", body.requestId)
    .maybeSingle();
  if (!request || !request.approval_id) {
    return new Response("Forbidden: no approved payment link", { status: 403 });
  }
  if (request.status === "locked") {
    return new Response("Locked", { status: 423 });
  }

  // (2-a) 프로젝트당 2회 한도 — 초과는 차단이 아니라 사유+대표승인 필요
  const { count: usedCount } = await db
    .from("tax_access_logs")
    .select("id", { count: "exact", head: true })
    .eq("expert_id", request.expert_id)
    .eq("project_id", request.project_id)
    .eq("reason", request.reason);
  if ((usedCount ?? 0) >= PROJECT_LIMIT && !request.over_limit_approved_by) {
    return new Response("Over project limit: needs representative approval", {
      status: 409,
    });
  }

  // (2-b) 시간당 복호화 상한 — 초과 시 자동 잠금 + 경보
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const { data: limitRow } = await db
    .from("tax_rate_limits")
    .select("id, count, locked_until")
    .eq("subject_type", "user")
    .eq("subject_id", request.requested_by)
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();
  if (limitRow?.locked_until) {
    return new Response("Rate limited (locked)", { status: 429 });
  }
  if ((limitRow?.count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    // 자동 잠금 + 경보 (경보 발송은 배포 시 배선)
    await db.from("tax_rate_limits").upsert(
      {
        subject_type: "user",
        subject_id: request.requested_by,
        window_start: windowStart.toISOString(),
        count: (limitRow?.count ?? 0) + 1,
        locked_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "subject_type,subject_id,window_start" }
    );
    return new Response("Rate limited", { status: 429 });
  }

  // (3) 앞조각(메인) + 뒷조각(저장소 B) 결합 후 복호화
  //     — 실제 복호화·파일 생성은 저장소 B 프로비저닝(2.4) 후 활성화한다.
  //     아래는 조각 결합·키 유도·AES-GCM 복호화의 배선 위치를 명시한 스캐폴드다.
  const { data: front } = await db
    .from("rrn_fragments_front")
    .select("id, front_ciphertext, wrapped_dek, alg")
    .eq("expert_id", request.expert_id)
    .is("purged_at", null)
    .maybeSingle();
  if (!front) {
    return new Response("No RRN on file", { status: 404 });
  }

  // TODO(2.4): storeB()에서 뒷조각 fetch → argon2Verify(lookupPassword,...)로
  //   래핑키 유도 → wrapped_dek 언래핑 → AES-GCM으로 front+back 복호화 →
  //   지급명세서 파일 생성. 평문은 메모리에서만, 생성 후 즉시 폐기.
  void argon2Verify; // 배포 시 사용 (미사용 경고 방지용 스캐폴드 참조)
  void storeB;

  // (5) 조회 기록 + 전문가 통지 (파일 생성도 조회로 간주 — §8)
  await db.from("tax_access_logs").insert({
    expert_id: request.expert_id,
    tenant_id: request.tenant_id,
    project_id: request.project_id,
    reason: request.reason,
    access_type: "file_generation",
    accessor_label: null, // 배포 시 요청자 직책/이름 스냅샷
  });
  await db.from("tax_rate_limits").upsert(
    {
      subject_type: "user",
      subject_id: request.requested_by,
      window_start: windowStart.toISOString(),
      count: (limitRow?.count ?? 0) + 1,
    },
    { onConflict: "subject_type,subject_id,window_start" }
  );
  await db
    .from("tax_access_requests")
    .update({ status: "fulfilled" })
    .eq("id", request.id);

  // 스캐폴드 단계에서는 복호화 결과를 반환하지 않는다(저장소 B 미연결).
  return new Response(
    JSON.stringify({
      ok: false,
      scaffold: true,
      message:
        "복호화 서비스 스캐폴드입니다. 저장소 B 프로비저닝·시크릿 설정 후 활성화됩니다.",
    }),
    { headers: { "content-type": "application/json" }, status: 501 }
  );
});
