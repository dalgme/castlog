import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * 시크릿 암호화 (AES-256-GCM) — 테넌트 SMS API 키 등 저장용 (CLAUDE.md 5-2)
 *
 * 키: SECRETS_ENCRYPTION_KEY (base64, 32바이트). 서버 전용 환경변수 —
 * NEXT_PUBLIC_ 접두사 금지. 키 분실 시 저장된 시크릿은 복호화 불가(재등록 필요).
 * 저장 형식: base64(iv).base64(ciphertext).base64(authTag)
 */

function loadKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY가 설정되지 않았습니다 (base64 32바이트 — .env.example 참조)."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SECRETS_ENCRYPTION_KEY는 base64 인코딩된 32바이트여야 합니다.");
  }
  return key;
}

export function hasSecretsKey(): boolean {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const [ivB64, dataB64, tagB64] = stored.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("잘못된 시크릿 저장 형식입니다.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
