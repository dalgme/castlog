import "server-only";

import { createHmac, randomBytes } from "crypto";

/**
 * SMS 공급자 어댑터 (CLAUDE.md 5-2 — 테넌트별 BYO 공급자)
 *
 * 각 테넌트가 자사 계정·자사 발신번호로 발송한다.
 * SMS_TEST_MODE=true면 실발송 없이 성공 처리(status 'test')한다.
 */

export type SmsProviderKey = "solapi" | "aligo" | "nhncloud";

export const SMS_PROVIDER_LABELS: Record<SmsProviderKey, string> = {
  solapi: "솔라피 (Solapi)",
  aligo: "알리고 (Aligo)",
  nhncloud: "NHN Cloud",
};

export type SmsSendParams = {
  to: string; // E.164 또는 국내 표기 — 어댑터에서 정규화
  from: string; // 사전등록 발신번호
  text: string;
};

export type SmsSendResult =
  | { ok: true; test?: boolean }
  | { ok: false; error: string };

export type SmsCredentials = {
  provider: SmsProviderKey;
  apiKey: string;
  apiSecret: string | null; // 솔라피: API Secret / 알리고: 사용자 ID
};

/** 국내 번호 표기(01012345678)로 변환 — 공급자 API 공통 요구 형식 */
function toLocalPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  return digits;
}

export function isSmsTestMode(): boolean {
  return process.env.SMS_TEST_MODE === "true";
}

/** 솔라피 — HMAC-SHA256 인증 (messages/v4) */
async function sendViaSolapi(
  creds: SmsCredentials,
  params: SmsSendParams
): Promise<SmsSendResult> {
  if (!creds.apiSecret) {
    return { ok: false, error: "솔라피 API Secret이 설정되지 않았습니다." };
  }
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", creds.apiSecret)
    .update(date + salt)
    .digest("hex");

  try {
    const response = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `HMAC-SHA256 apiKey=${creds.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({
        message: {
          to: toLocalPhone(params.to),
          from: toLocalPhone(params.from),
          text: params.text,
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, error: `solapi ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `solapi 요청 실패: ${error instanceof Error ? error.message : "network"}`,
    };
  }
}

/** 알리고 — key + user_id 폼 전송 */
async function sendViaAligo(
  creds: SmsCredentials,
  params: SmsSendParams
): Promise<SmsSendResult> {
  if (!creds.apiSecret) {
    return { ok: false, error: "알리고 사용자 ID가 설정되지 않았습니다." };
  }
  const form = new URLSearchParams({
    key: creds.apiKey,
    user_id: creds.apiSecret,
    sender: toLocalPhone(params.from),
    receiver: toLocalPhone(params.to),
    msg: params.text,
  });

  try {
    const response = await fetch("https://apis.aligo.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json = (await response.json()) as { result_code?: number | string };
    if (String(json.result_code) !== "1") {
      return { ok: false, error: `aligo result_code=${json.result_code}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `aligo 요청 실패: ${error instanceof Error ? error.message : "network"}`,
    };
  }
}

/** 어댑터 진입점 — 공급자별 분기. 테스트 모드는 실발송 생략. */
export async function sendSms(
  creds: SmsCredentials,
  params: SmsSendParams
): Promise<SmsSendResult> {
  if (isSmsTestMode()) {
    return { ok: true, test: true };
  }

  switch (creds.provider) {
    case "solapi":
      return sendViaSolapi(creds, params);
    case "aligo":
      return sendViaAligo(creds, params);
    case "nhncloud":
      return {
        ok: false,
        error: "NHN Cloud 어댑터는 준비 중입니다. 솔라피 또는 알리고를 사용하세요.",
      };
  }
}
