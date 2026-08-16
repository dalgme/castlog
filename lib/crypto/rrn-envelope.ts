/**
 * 주민등록번호 비대칭 봉투 암호 (Phase 2.4 — 브라우저 전용)
 * 설계: docs/decisions/rrn-phase2-secure-subsystem.md §5·§13
 *
 * 이 모듈은 **클라이언트(브라우저)에서만** 실행된다. 평문 주민번호는 이 코드가
 * 도는 메모리(입력 화면)에서만 존재하고, 서버·네트워크에는 암호문만 나간다.
 *
 * 키 계층:
 *   RRN(앞/뒤 분할) --AES-256-GCM(레코드 DEK)--> 앞조각·뒷조각 암호문
 *   DEK --RSA-OAEP-256(테넌트 공개키)--> wrapped_dek
 *   테넌트 개인키 --AES-256-GCM(조회비밀번호 Argon2id 유도키)--> wrapped_private_key
 */
import { argon2id } from "hash-wasm";

const enc = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("이 브라우저는 보안 암호화를 지원하지 않습니다.");
  return c.subtle;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return enc.encode(text) as Uint8Array<ArrayBuffer>;
}

export const ARGON2ID_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB = 64 MiB
  hashLength: 32,
} as const;

/** 조회 비밀번호 + salt → 32바이트 대칭키(AES-GCM용) */
async function deriveWrapKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const raw = await argon2id({
    password,
    salt,
    parallelism: ARGON2ID_PARAMS.parallelism,
    iterations: ARGON2ID_PARAMS.iterations,
    memorySize: ARGON2ID_PARAMS.memorySize,
    hashLength: ARGON2ID_PARAMS.hashLength,
    outputType: "binary",
  });
  const rawKey = new Uint8Array(raw); // ArrayBuffer 백업 사본 (BufferSource 호환)
  return subtle().importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export type TenantKeyMaterial = {
  publicKeyJwk: JsonWebKey;
  wrappedPrivateKey: string; // base64 AES-GCM 암호문
  kdfSalt: string; // base64
  kdfParams: typeof ARGON2ID_PARAMS;
  wrapIv: string; // base64
  alg: string;
};

/**
 * 테넌트 RRN 키페어 생성 + 개인키를 조회 비밀번호로 래핑.
 * 조회 비밀번호는 반환값·저장소 어디에도 담기지 않는다.
 */
export async function createTenantKeyMaterial(
  lookupPassword: string
): Promise<TenantKeyMaterial> {
  const s = subtle();
  const pair = (await s.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  )) as CryptoKeyPair;
  const publicKeyJwk = await s.exportKey("jwk", pair.publicKey);
  const privateKeyJwk = await s.exportKey("jwk", pair.privateKey);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await deriveWrapKey(lookupPassword, salt);
  const wrapped = await s.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    bytesOf(JSON.stringify(privateKeyJwk))
  );

  return {
    publicKeyJwk,
    wrappedPrivateKey: toB64(new Uint8Array(wrapped)),
    kdfSalt: toB64(salt),
    kdfParams: ARGON2ID_PARAMS,
    wrapIv: toB64(iv),
    alg: "RSA-OAEP-256/AES-256-GCM/argon2id",
  };
}

export type RrnEnvelope = {
  frontCiphertext: string; // base64 (iv|ct) — 메인 DB
  backCiphertext: string; // base64 (iv|ct) — 저장소 B
  wrappedDek: string; // base64 RSA-OAEP(DEK) — 메인 DB
};

async function gcmSeal(
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>
): Promise<string> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, data);
  const ctBytes = new Uint8Array(ct);
  const joined = new Uint8Array(iv.length + ctBytes.length);
  joined.set(iv, 0);
  joined.set(ctBytes, iv.length);
  return toB64(joined);
}

/**
 * 주민번호(13자리)를 앞/뒤로 분할·암호화하고 DEK를 테넌트 공개키로 래핑.
 * 앞조각은 메인 DB, 뒷조각은 저장소 B에 저장한다(물리 분리).
 */
export async function encryptRrnEnvelope(
  rrn13: string,
  publicKeyJwk: JsonWebKey
): Promise<RrnEnvelope> {
  const digits = rrn13.replace(/\D/g, "");
  if (digits.length !== 13) throw new Error("주민등록번호 13자리를 정확히 입력하세요.");

  const s = subtle();
  const dek = await s.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ]);
  const front = await gcmSeal(dek, bytesOf(digits.slice(0, 6)));
  const back = await gcmSeal(dek, bytesOf(digits.slice(6)));

  const pubKey = await s.importKey(
    "jwk",
    publicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const rawDek = await s.exportKey("raw", dek);
  const wrappedDek = await s.encrypt({ name: "RSA-OAEP" }, pubKey, rawDek);

  return {
    frontCiphertext: front,
    backCiphertext: back,
    wrappedDek: toB64(new Uint8Array(wrappedDek)),
  };
}
