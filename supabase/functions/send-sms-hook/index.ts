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

async function logOtpSend(phone: string, status: string, error: string | null) {
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
        tenant_id: null, // 전역(플랫폼) 발송 — 사용량 계측용
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

  const apiKey = Deno.env.get("SOLAPI_API_KEY");
  const apiSecret = Deno.env.get("SOLAPI_API_SECRET");
  const sender = Deno.env.get("SOLAPI_SENDER");
  if (!apiKey || !apiSecret || !sender) {
    return errorResponse(
      400,
      "SMS 발송이 아직 구성되지 않았습니다 (SOLAPI 시크릿 미설정). 테스트 번호를 사용하세요."
    );
  }

  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");

  try {
    const response = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({
        message: {
          to: toLocalPhone(phone),
          from: toLocalPhone(sender),
          text: `[CASTLOG] 인증번호 [${otp}]를 입력해 주세요.`,
        },
      }),
    });

    if (!response.ok) {
      // 솔라피 오류 응답에는 errorCode/errorMessage만 있다 (OTP·키 없음) —
      // 원인(발신번호 미등록·잔액·키 오류)이 여기 실려 오므로 로그에 남긴다
      const errBody = (await response.text().catch(() => "")).slice(0, 300);
      console.error("solapi rejected:", response.status, errBody);
      await logOtpSend(
        phone,
        "failed",
        `solapi ${response.status} ${errBody.slice(0, 160)}`.trim()
      );
      return errorResponse(500, "인증번호 발송에 실패했습니다.");
    }

    await logOtpSend(phone, "sent", null);
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("solapi request error:", String(err));
    await logOtpSend(phone, "failed", "network");
    return errorResponse(500, "인증번호 발송 중 오류가 발생했습니다.");
  }
});
