/**
 * 전문가 서류 규칙 (설계문서 10.1 / CLAUDE.md 5·6)
 *
 * - 서류의 소유자는 전문가. 기업은 grants가 허용한 유형만 열람.
 * - 민감 서류는 리사이즈하지 않는다 (원본 판독 필요).
 * - 열람은 서버 발급 만료 서명 URL로만. 공개 URL 금지.
 */

export const EXPERT_DOCUMENT_BUCKET = "expert-documents";

/** 서류함에 슬롯으로 노출하는 표준 업로드 유형 (signature는 서명 캔버스로 별도 수집) */
export const STANDARD_UPLOAD_DOCUMENT_TYPES = [
  "resume",
  "bank_account_copy",
  "id_card_copy",
  "business_card",
  "business_registration",
] as const;

/**
 * 업로드 가능 서류 유형.
 * 'attachment'는 외부 송신용 일반 첨부 — 서류함 슬롯에는 노출하지 않지만
 * 서버 업로드는 허용한다(STANDARD_UPLOAD_DOCUMENT_TYPES와 구분).
 */
export const UPLOADABLE_DOCUMENT_TYPES = [
  ...STANDARD_UPLOAD_DOCUMENT_TYPES,
  "attachment",
  // 통합서류(혼합) — 기업 파일 일괄 등록에서 생기며, 전문가 본인도 교체 가능
  "combined",
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
  attachment: "첨부파일",
  certificate: "자격증 사본",
  combined: "통합서류(혼합)",
};

/**
 * 기업 열람 허용(grants) 대상 유형 — 표준 슬롯 + 자격증 사본.
 * attachment(외부 송신용)·signature/seal은 각자의 흐름에서 노출되므로 제외.
 */
export const GRANTABLE_DOCUMENT_TYPES = [
  ...STANDARD_UPLOAD_DOCUMENT_TYPES,
  "certificate",
  "combined",
] as const;

export function isGrantableDocumentType(value: string): boolean {
  return (GRANTABLE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * 서명·날인 유형 (단계 28-A + 개정 2026-08-22) — 서명은 캔버스+이미지 업로드
 * 겸용, 날인은 이미지 업로드 전용. 암호화 버킷 저장·서명 URL 열람은 동일.
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

/**
 * 확장자 → { 브라우저가 보낼 수 있는 MIME 목록, 저장용 정규 MIME } (개정 2026-08-22).
 * 브라우저는 hwp/hwpx 등에서 octet-stream이나 빈 값을 보내므로 확장자를 축으로
 * 검증하고, 스토리지에는 정규 MIME으로 저장한다 (버킷 allowed_mime_types는
 * 정규 MIME 목록과 동일 — 마이그레이션 20260822000004).
 */
const OCTET = ["application/octet-stream", ""] as const;
export const ALLOWED_DOCUMENT_EXTENSIONS: Record<
  string,
  { mimes: readonly string[]; canonical: string }
> = {
  pdf: { mimes: ["application/pdf"], canonical: "application/pdf" },
  jpg: { mimes: ["image/jpeg"], canonical: "image/jpeg" },
  jpeg: { mimes: ["image/jpeg"], canonical: "image/jpeg" },
  png: { mimes: ["image/png"], canonical: "image/png" },
  doc: {
    mimes: ["application/msword", ...OCTET],
    canonical: "application/msword",
  },
  docx: {
    mimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...OCTET,
    ],
    canonical:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xls: {
    mimes: ["application/vnd.ms-excel", ...OCTET],
    canonical: "application/vnd.ms-excel",
  },
  xlsx: {
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ...OCTET,
    ],
    canonical:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ppt: {
    mimes: ["application/vnd.ms-powerpoint", ...OCTET],
    canonical: "application/vnd.ms-powerpoint",
  },
  pptx: {
    mimes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ...OCTET,
    ],
    canonical:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  hwp: {
    mimes: [
      "application/x-hwp",
      "application/haansofthwp",
      "application/vnd.hancom.hwp",
      ...OCTET,
    ],
    canonical: "application/x-hwp",
  },
  hwpx: {
    mimes: [
      "application/hwp+zip",
      "application/vnd.hancom.hwpx",
      ...OCTET,
    ],
    canonical: "application/hwp+zip",
  },
};

/** 업로드 input accept 속성용 */
export const DOCUMENT_ACCEPT_ATTR = Object.keys(ALLOWED_DOCUMENT_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(",");

/** 웹 미리보기 방식 판정 — none은 뷰어에서 '원본 열기' 폴백으로 안내 */
export type DocumentPreviewKind = "image" | "pdf" | "sheet" | "docx" | "none";

export function documentPreviewKind(fileName: string): DocumentPreviewKind {
  const ext = fileExtension(fileName);
  if (["jpg", "jpeg", "png"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx"].includes(ext)) return "sheet";
  if (ext === "docx") return "docx";
  return "none";
}

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

/** MIME·확장자 서버 검증 — 통과 시 정규 확장자·저장용 MIME 반환 */
export function validateDocumentFile(
  mimeType: string,
  fileName: string,
  sizeBytes: number
):
  | { ok: true; extension: string; contentType: string }
  | { ok: false; error: string } {
  if (sizeBytes <= 0) {
    return { ok: false, error: "빈 파일은 업로드할 수 없습니다." };
  }
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    return { ok: false, error: "파일 용량은 10MB 이하여야 합니다." };
  }
  const ext = fileExtension(fileName);
  const rule = ALLOWED_DOCUMENT_EXTENSIONS[ext];
  if (!rule) {
    return {
      ok: false,
      error:
        "PDF, 이미지(JPG/PNG), 오피스(doc/docx/xls/xlsx/ppt/pptx), 한글(hwp/hwpx) 파일만 업로드할 수 있습니다.",
    };
  }
  if (!rule.mimes.includes(mimeType)) {
    return { ok: false, error: "파일 확장자가 형식과 일치하지 않습니다." };
  }
  return { ok: true, extension: ext, contentType: rule.canonical };
}
