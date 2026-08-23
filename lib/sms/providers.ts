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
  /** MMS 이미지 (기획 확정 2026-08-23) — 공급자에 업로드된 이미지 id. 솔라피만 지원 */
  imageId?: string | null;
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

/** 솔라피 HMAC-SHA256 인증 헤더 */
function solapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** MMS 이미지 상한 — 솔라피 규격 (JPG, 200KB) */
export const MMS_IMAGE_MAX_BYTES = 200 * 1024;

/**
 * MMS 이미지 업로드 (기획 확정 2026-08-23) — 발송 전 공급자 저장소에 올리고
 * imageId를 받는다. 솔라피만 지원한다.
 */
export async function uploadMmsImage(
  creds: SmsCredentials,
  input: { base64: string; name: string }
): Promise<{ ok: true; imageId: string; test?: boolean } | { ok: false; error: string }> {
  if (isSmsTestMode()) {
    return { ok: true, imageId: "test-image", test: true };
  }
  if (creds.provider !== "solapi") {
    return {
      ok: false,
      error: "이미지(MMS) 발송은 현재 솔라피 연동에서만 지원됩니다.",
    };
  }
  if (!creds.apiSecret) {
    return { ok: false, error: "솔라피 API Secret이 설정되지 않았습니다." };
  }

  try {
    const response = await fetch("https://api.solapi.com/storage/v1/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: solapiAuthHeader(creds.apiKey, creds.apiSecret),
      },
      body: JSON.stringify({
        file: input.base64,
        type: "MMS",
        name: input.name,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        error: `이미지 업로드 실패 (solapi ${response.status}): ${detail.slice(0, 200)}`,
      };
    }
    const json = (await response.json()) as { fileId?: string };
    if (!json.fileId) {
      return { ok: false, error: "이미지 업로드 응답에 fileId가 없습니다." };
    }
    return { ok: true, imageId: json.fileId };
  } catch (error) {
    return {
      ok: false,
      error: `이미지 업로드 실패: ${error instanceof Error ? error.message : "network"}`,
    };
  }
}

/** 솔라피 — HMAC-SHA256 인증 (messages/v4) */
async function sendViaSolapi(
  creds: SmsCredentials,
  params: SmsSendParams
): Promise<SmsSendResult> {
  if (!creds.apiSecret) {
    return { ok: false, error: "솔라피 API Secret이 설정되지 않았습니다." };
  }
  try {
    const response = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: solapiAuthHeader(creds.apiKey, creds.apiSecret),
      },
      body: JSON.stringify({
        message: {
          to: toLocalPhone(params.to),
          from: toLocalPhone(params.from),
          text: params.text,
          // 이미지 첨부 시 MMS — 솔라피가 imageId로 형식을 판정한다
          ...(params.imageId ? { type: "MMS", imageId: params.imageId } : {}),
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
