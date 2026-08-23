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

/**
 * 파일명 속 숫자열에서 휴대폰 뒷 4자리 후보 추출.
 * 전화로 볼 수 있는 꼴만 인정한다 — 정확히 4자리(뒷자리 표기) 또는
 * 10자리 이상(전체 번호). 날짜(6·8자리) 같은 숫자열은 무시해 오매칭을 막는다.
 */
export function extractPhoneTail(fileName: string): string | null {
  const runs = fileName.match(/\d+/g);
  if (!runs) return null;
  const phoneLike = runs.filter((r) => r.length === 4 || r.length >= 10);
  if (phoneLike.length === 0) return null;
  const best = [...phoneLike].sort((a, b) => b.length - a.length)[0]!;
  return best.slice(-4);
}

/** 파일명에서 확장자·구분자를 뗀 본문 (이름 매칭용) */
export function fileNameBody(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_\-.\s()\[\]]+/g, " ").trim();
}

/**
 * 이름 매칭 — 파일명 토큰이 이름과 **정확히 일치**할 때만 인정한다.
 * 부분 포함("김수" ⊂ "김수현")으로 다른 사람에게 민감서류가 붙는 것을 막는다.
 */
export function nameMatches(fileName: string, expertName: string): boolean {
  return fileNameBody(fileName)
    .split(" ")
    .some((token) => token === expertName);
}
