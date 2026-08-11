/**
 * 전문가 서류 규칙 (설계문서 10.1 / CLAUDE.md 5·6)
 *
 * - 서류의 소유자는 전문가. 기업은 grants가 허용한 유형만 열람.
 * - 민감 서류는 리사이즈하지 않는다 (원본 판독 필요).
 * - 열람은 서버 발급 만료 서명 URL로만. 공개 URL 금지.
 */

export const EXPERT_DOCUMENT_BUCKET = "expert-documents";

/** 업로드 가능 서류 유형 (signature는 서명 캔버스로 별도 수집 — 단계 11) */
export const UPLOADABLE_DOCUMENT_TYPES = [
  "resume",
  "bank_account_copy",
  "id_card_copy",
  "business_card",
  "business_registration",
] as const;
export type UploadableDocumentType = (typeof UPLOADABLE_DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  resume: "이력서",
  bank_account_copy: "통장사본",
  id_card_copy: "신분증사본",
  business_card: "명함",
  business_registration: "사업자등록증",
  signature: "서명",
  seal: "날인(도장)",
};

/**
 * 서명 캔버스로 수집하는 유형 (단계 28-A) — 파일 업로드가 아니라 PNG 캔버스.
 * 암호화 버킷 저장·서명 URL 열람은 다른 서류와 동일.
 */
export const SIGNATURE_CANVAS_TYPES = ["signature", "seal"] as const;
export type SignatureCanvasType = (typeof SIGNATURE_CANVAS_TYPES)[number];

export function isSignatureCanvasType(
  value: string
): value is SignatureCanvasType {
  return (SIGNATURE_CANVAS_TYPES as readonly string[]).includes(value);
}

/** 서명·날인 PNG 상한 (캔버스 산출물은 작다 — 넉넉히 2MB) */
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/** 민감도 표기 — 신분증·통장사본은 열람 로그가 특히 중요 (설계문서 4.4) */
export const SENSITIVE_DOCUMENT_TYPES: readonly string[] = [
  "bank_account_copy",
  "id_card_copy",
];

/** 서버 검증 상한 (버킷 file_size_limit와 동일) */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** 허용 MIME ↔ 확장자 (버킷 allowed_mime_types와 동일 목록) */
export const ALLOWED_DOCUMENT_MIME_TYPES: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

export function isUploadableDocumentType(
  value: string
): value is UploadableDocumentType {
  return (UPLOADABLE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** 파일명 확장자 추출 (소문자) */
export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

/** MIME·확장자 서버 검증 — 통과 시 정규 확장자 반환, 실패 시 null */
export function validateDocumentFile(
  mimeType: string,
  fileName: string,
  sizeBytes: number
): { ok: true; extension: string } | { ok: false; error: string } {
  if (sizeBytes <= 0) {
    return { ok: false, error: "빈 파일은 업로드할 수 없습니다." };
  }
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    return { ok: false, error: "파일 용량은 10MB 이하여야 합니다." };
  }
  const allowedExts = ALLOWED_DOCUMENT_MIME_TYPES[mimeType];
  if (!allowedExts) {
    return { ok: false, error: "PDF, JPG, PNG 파일만 업로드할 수 있습니다." };
  }
  const ext = fileExtension(fileName);
  if (!allowedExts.includes(ext)) {
    return { ok: false, error: "파일 확장자가 형식과 일치하지 않습니다." };
  }
  return { ok: true, extension: ext };
}
