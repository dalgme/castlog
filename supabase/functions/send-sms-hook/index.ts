/**
 * Supabase Auth — Send SMS Hook (인증 OTP 전용, CLAUDE.md 5-2)
 *
 * 인증 OTP는 테넌트 귀속이 불가능한 전역 발송 → 플랫폼 운영사(넥스트랩)의
 * 솔라피 계정으로 발송한다. 업무·광고 SMS는 테넌트별 BYO 공급자(앱 내 발송 화면).
 *
 * 필요한 Function Secrets (supabase functions secrets):
 *  - SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER (운영사 계정·발신번호)
 *  - SEND_SMS_HOOK_SECRET (대시보드 Hook 시크릿 v1,whsec_... — 요청 서명 검증)
 * 미설정 시 명시적 오류를 반환한다 (테스트 번호는 Hook을 거치지 않음).
 *
 * 보안: OTP 값은 어떤 로그에도 남기지 않는다. 사용량 계측은 마스킹 본문으로 기록.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
// Deno 엣지 런타임에는 Buffer 전역이 없다 — 명시적으로 가져와야 한다
import { Buffer } from "node:buffer";

type HookPayload = {
  user?: { phone?: string; id?: string };
  sms?: { otp?: string };
};

function verifySignature(req: Request, payload: string): boolean {
  const secretRaw = Deno.env.get("SEND_SMS_HOOK_SECRET");
  // 시크릿 미설정 시 검증을 거부한다(fail-closed). 열어두면 훅 URL을 아는
  // 제3자가 운영사 발신번호로 임의 문자를 무제한 발송할 수 있다.
  if (!secretRaw) return false;

  const secretB64 = secretRaw.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const msgId = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signatureHeader = req.headers.get("webhook-signature") ?? "";
  if (!msgId || !timestamp || !signatureHeader) return false;

  const signedContent = `${msgId}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(signedContent)
    .digest("base64");

  // 헤더 형식: "v1,<base64sig> v1,<base64sig> ..."
  return signatureHeader.split(" ").some((part) => {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    try {
      const a = Buffer.from(sig, "base64");
      const b = Buffer.from(expected, "base64");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

function toLocalPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  return digits;
}

async function logOtpSend(
  phone: string,
  status: string,
  error: string | null,
  tenantId: string | null = null
) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return;
  try {
    const res = await fetch(`${url}/rest/v1/sms_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        tenant_id: tenantId, // null = 전역(플랫폼 계정) 발송 / 값 = 테넌트 BYO 발송
        message_type: "auth_otp",
        recipient_phone: phone,
        body: "[인증번호 발송]", // OTP 값 저장 금지
        status,
        provider: "solapi",
        error_message: error,
      }),
    });
    if (!res.ok) {
      // fetch는 4xx에서 throw하지 않는다 — 기록 실패가 조용히 사라지면
      // 운영 진단이 막히므로 함수 로그에는 남긴다 (OTP·키 미포함)
      console.error(
        "sms_logs insert failed:",
        res.status,
        (await res.text().catch(() => "")).slice(0, 300)
      );
    }
  } catch (err) {
    // 로그 실패는 발송 자체를 막지 않는다
    console.error("sms_logs insert error:", String(err));
  }
}

/** 솔라피 발송 — 플랫폼·테넌트 공용. 실패 시 응답 본문(원인)을 함께 돌려준다. */
async function sendViaSolapi(
  apiKey: string,
  apiSecret: string,
  from: string,
  to: string,
  text: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");

  const response = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({
      message: {
        to: toLocalPhone(to),
        from: toLocalPhone(from),
        text,
      },
    }),
  });

  // 솔라피 오류 응답에는 errorCode/errorMessage만 있다 (OTP·키 없음)
  const body = response.ok
    ? ""
    : (await response.text().catch(() => "")).slice(0, 300);
  return { ok: response.ok, status: response.status, body };
}

/**
 * 앱이 저장한 시크릿 복호화 (lib/crypto/secrets.ts와 동일 형식):
 * AES-256-GCM, 저장 형식 base64(iv).base64(ciphertext).base64(authTag),
 * 키는 SECRETS_ENCRYPTION_KEY (base64 32바이트 — Vercel과 같은 값).
 */
async function decryptStoredSecret(
  stored: string,
  keyB64: string
): Promise<string> {
  const [ivB64, dataB64, tagB64] = stored.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("잘못된 시크릿 저장 형식");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyB64, "base64"),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  // WebCrypto는 ciphertext 뒤에 authTag가 붙은 형태를 기대한다
  const sealed = Buffer.concat([
    Buffer.from(dataB64, "base64"),
    Buffer.from(tagB64, "base64"),
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(ivB64, "base64") },
    key,
    sealed
  );
  return new TextDecoder().decode(plain);
}

type TenantSender = {
  tenantId: string;
  tenantName: string;
  apiKey: string;
  apiSecret: string;
  sender: string;
};

/**
 * 테넌트 라우팅 (CLAUDE.md 5-2 개정) — 이 인증이 어느 회사의 등록 링크(/j)에서
 * 시작됐는지 auth_otp_routing에서 찾고, 그 회사의 BYO 솔라피 자격증명을 푼다.
 * 어떤 이유로든 실패하면 null → 플랫폼(운영사) 계정 폴백. 여기서 throw로
 * 인증 자체를 죽이면 안 된다.
 */
async function resolveTenantSender(
  phoneDigits: string
): Promise<TenantSender | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    const routingRes = await fetch(
      `${url}/rest/v1/auth_otp_routing?phone=eq.${phoneDigits}&select=tenant_id,created_at,tenants(name)`,
      { headers }
    );
    if (!routingRes.ok) {
      // 테이블 미생성(마이그레이션 미적용) 등 — 플랫폼 폴백으로 계속 동작한다
      console.error("otp routing lookup failed:", routingRes.status);
      return null;
    }
    const rows = (await routingRes.json()) as Array<{
      tenant_id: string;
      created_at: string;
      tenants: { name: string } | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    // 오래된 라우팅은 무시 — 등록 요청 직후(재발송 포함)에만 유효
    if (Date.now() - Date.parse(row.created_at) > 10 * 60 * 1000) return null;

    const cfgRes = await fetch(
      `${url}/rest/v1/tenant_sms_configs?tenant_id=eq.${row.tenant_id}&select=provider,mode,api_key_encrypted,api_secret_encrypted,sender_number,is_active`,
      { headers }
    );
    if (!cfgRes.ok) {
      console.error("tenant sms config lookup failed:", cfgRes.status);
      return null;
    }
    const cfg = ((await cfgRes.json()) as Array<{
      provider: string;
      mode: string | null;
      api_key_encrypted: string | null;
      api_secret_encrypted: string | null;
      sender_number: string;
      is_active: boolean;
    }>)[0];
    if (
      !cfg ||
      !cfg.is_active ||
      cfg.provider !== "solapi" || // 훅은 솔라피만 지원 — 그 외는 플랫폼 폴백
      cfg.mode === "platform" || // b안(캐스트로그 계정)은 자사 키가 없다
      !cfg.api_key_encrypted ||
      !cfg.api_secret_encrypted
    ) {
      return null;
    }

    const encKey = Deno.env.get("SECRETS_ENCRYPTION_KEY");
    if (!encKey) {
      console.error(
        "SECRETS_ENCRYPTION_KEY 미설정 — 테넌트 OTP 라우팅 비활성(플랫폼 폴백)"
      );
      return null;
    }

    return {
      tenantId: row.tenant_id,
      tenantName: row.tenants?.name ?? "",
      apiKey: await decryptStoredSecret(cfg.api_key_encrypted, encKey),
      apiSecret: await decryptStoredSecret(cfg.api_secret_encrypted, encKey),
      sender: cfg.sender_number,
    };
  } catch (err) {
    console.error("otp tenant routing error:", String(err));
    return null;
  }
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  const payload = await req.text();

  if (!verifySignature(req, payload)) {
    return errorResponse(401, "웹훅 서명 검증에 실패했습니다.");
  }

  let parsed: HookPayload;
  try {
    parsed = JSON.parse(payload) as HookPayload;
  } catch {
    return errorResponse(400, "잘못된 요청 본문입니다.");
  }

  const phone = parsed.user?.phone;
  const otp = parsed.sms?.otp;
  if (!phone || !otp) {
    return errorResponse(400, "전화번호 또는 인증번호가 없습니다.");
  }

  const okResponse = new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  // ── 1) 테넌트 경로 — 회사가 만든 등록 링크(/j)에서 시작된 인증이면
  //       그 회사의 BYO 솔라피 계정·발신번호·회사명으로 발송한다 (화이트라벨 §16)
  const tenant = await resolveTenantSender(phone.replace(/\D/g, ""));
  if (tenant) {
    try {
      const sent = await sendViaSolapi(
        tenant.apiKey,
        tenant.apiSecret,
        tenant.sender,
        phone,
        `[${tenant.tenantName || "CASTLOG"}] 인증번호 [${otp}]를 입력해 주세요.`
      );
      if (sent.ok) {
        await logOtpSend(phone, "sent", null, tenant.tenantId);
        return okResponse;
      }
      // 테넌트 계정 발송 실패(키 오류·잔액·발신번호)는 인증을 죽이지 않고
      // 플랫폼 계정으로 폴백한다 — 실패 사실은 로그·계측에 남긴다
      console.error("tenant solapi rejected:", sent.status, sent.body);
      await logOtpSend(
        phone,
        "failed",
        `tenant solapi ${sent.status} ${sent.body.slice(0, 140)}`.trim(),
        tenant.tenantId
      );
    } catch (err) {
      console.error("tenant solapi request error:", String(err));
    }
  }

  // ── 2) 플랫폼(운영사) 경로 — 기본이자 폴백: 전역 로그인, 라우팅 없음/실패
  const apiKey = Deno.env.get("SOLAPI_API_KEY");
  const apiSecret = Deno.env.get("SOLAPI_API_SECRET");
  const sender = Deno.env.get("SOLAPI_SENDER");
  if (!apiKey || !apiSecret || !sender) {
    return errorResponse(
      400,
      "SMS 발송이 아직 구성되지 않았습니다 (SOLAPI 시크릿 미설정). 테스트 번호를 사용하세요."
    );
  }

  try {
    const sent = await sendViaSolapi(
      apiKey,
      apiSecret,
      sender,
      phone,
      `[CASTLOG] 인증번호 [${otp}]를 입력해 주세요.`
    );

    if (!sent.ok) {
      // 원인(발신번호 미등록·잔액·키 오류)이 응답 본문에 실려 온다 — 로그에 남긴다
      console.error("solapi rejected:", sent.status, sent.body);
      await logOtpSend(
        phone,
        "failed",
        `solapi ${sent.status} ${sent.body.slice(0, 160)}`.trim()
      );
      return errorResponse(500, "인증번호 발송에 실패했습니다.");
    }

    await logOtpSend(phone, "sent", null);
    return okResponse;
  } catch (err) {
    console.error("solapi request error:", String(err));
    await logOtpSend(phone, "failed", "network");
    return errorResponse(500, "인증번호 발송 중 오류가 발생했습니다.");
  }
});
