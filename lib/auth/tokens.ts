import "server-only";

import { createHash, randomBytes } from "crypto";

/**
 * 공개 매직링크 토큰 (설계문서 5.2)
 *
 * 원문 토큰은 링크로만 전달하고 DB에는 SHA-256 해시만 저장한다 —
 * DB가 유출되어도 유효한 링크를 재구성할 수 없다.
 */

/** URL-safe 랜덤 토큰 (32바이트 = 43자 base64url) */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 저장·조회용 SHA-256 해시 (hex) */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
