/**
 * 파일 일괄 등록 — 파일명 자동 매칭·유형 분류 (기획 확정 2026-08-23).
 *
 * 기업이 보유한 전문가 서류 파일명을 읽어
 *  1) 유형(이력서/신분증사본/통장사본)을 키워드로 추정하고
 *  2) 휴대폰 뒷자리(정확) → 이름(유일할 때) 순으로 전문가를 매칭한다.
 * 키워드가 둘 이상이거나 없으면 '통합서류(혼합)' — 가장 민감한 서류 기준의
 * 보호를 통째로 적용한다 (기획 확정).
 * 순수 함수 — 클라이언트 미리보기와 서버 검증이 같은 규칙을 쓴다.
 */

export type BulkDocType =
  | "resume"
  | "id_card_copy"
  | "bank_account_copy"
  | "combined";

export const BULK_DOC_TYPE_LABELS: Record<BulkDocType, string> = {
  resume: "이력서",
  id_card_copy: "신분증사본",
  bank_account_copy: "통장사본",
  combined: "통합서류(혼합)",
};

export const BULK_DOC_TYPES = [
  "resume",
  "id_card_copy",
  "bank_account_copy",
  "combined",
] as const;

export function isBulkDocType(value: unknown): value is BulkDocType {
  return (
    typeof value === "string" &&
    (BULK_DOC_TYPES as readonly string[]).includes(value)
  );
}

const TYPE_KEYWORDS: { type: Exclude<BulkDocType, "combined">; words: string[] }[] = [
  { type: "resume", words: ["이력", "경력", "resume", "cv", "프로필"] },
  { type: "id_card_copy", words: ["신분", "주민", "면허", "여권", "idcard", "id_"] },
  { type: "bank_account_copy", words: ["통장", "계좌", "bank", "account"] },
];

/** 파일명에서 서류 유형 추정 — 복수·무매칭이면 통합서류 */
export function classifyDocFileName(fileName: string): BulkDocType {
  const lowered = fileName.toLowerCase();
  const hits = TYPE_KEYWORDS.filter((k) =>
    k.words.some((w) => lowered.includes(w))
  );
  if (hits.length === 1) return hits[0]!.type;
  return "combined";
}

/** 파일명 속 숫자열에서 휴대폰 뒷 4자리 후보 추출 (4자리 이상 숫자열의 끝 4자리) */
export function extractPhoneTail(fileName: string): string | null {
  const runs = fileName.match(/\d{4,}/g);
  if (!runs || runs.length === 0) return null;
  // 가장 긴 숫자열 우선 — 날짜(8자리)보다 전화(10~11자리)가 길다
  const best = [...runs].sort((a, b) => b.length - a.length)[0]!;
  return best.slice(-4);
}

/** 파일명에서 확장자·구분자를 뗀 본문 (이름 매칭용) */
export function fileNameBody(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_\-.\s()\[\]]+/g, " ").trim();
}
