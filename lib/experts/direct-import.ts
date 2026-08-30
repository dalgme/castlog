import { z } from "zod";

import { normalizeKrMobileE164 } from "@/lib/auth/phone";
import { restoreLeadingZero } from "@/lib/experts/import";

/**
 * 보유자료로 전문가 가입/등록 (기획 개정 2026-08-22)
 *
 * 기존 일괄 등록(등록 요청 링크 발급)과 달리, 기업이 이미 보유한 명단으로
 * experts 레코드를 **직접 생성**하고 자사 관계(expert_tenant_links,
 * relation_source='bulk_registered')를 만든다. 전문가 본인은 나중에 휴대폰
 * 인증으로 로그인하는 순간 이 레코드를 자기 계정으로 넘겨받는다(claim).
 *
 * 이미 존재하는 전문가(같은 휴대폰)는 데이터를 덮어쓰지 않는다 — 전역
 * 테이블은 전문가 소유(§4)이므로, 비어 있는 항목만 채우고 관계만 추가한다.
 */

export const DIRECT_IMPORT_HEADERS = [
  "이름",
  "소속",
  "직위",
  "이메일",
  "핸드폰번호",
  "은행명",
  "계좌번호",
  "예금주",
  "거주지",
  "최종학위 및 자격증",
  "강의(멘토링) 가능분야",
  "간략 이력",
] as const;

export const DIRECT_IMPORT_MAX_ROWS = 500;
export const DIRECT_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const directImportRowSchema = z.object({
  name: z.string().trim().min(1, "이름이 없습니다").max(50, "이름은 50자 이내"),
  organization: z.string().trim().max(100).optional().default(""),
  jobTitle: z.string().trim().max(100).optional().default(""),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /.+@.+\..+/.test(v), "이메일 형식이 아닙니다"),
  phone: z.string().trim().min(1, "핸드폰번호가 없습니다"),
  bankName: z.string().trim().max(50),
  accountNumber: z
    .string()
    .trim()
    .max(50)
    .refine(
      (v) => v === "" || v.replace(/\D/g, "").length >= 6,
      "계좌번호 형식이 아닙니다"
    ),
  accountHolder: z.string().trim().max(50),
  residence: z.string().trim().max(100),
  degreeCertifications: z.string().trim().max(500),
  expertiseFieldsText: z.string().trim().max(500),
  bio: z.string().trim().max(2000),
});

export type DirectImportRowInput = z.infer<typeof directImportRowSchema>;

export type DirectImportRowStatus =
  | "create" // 신규 전문가 생성 + 자사 관계
  | "link" // 이미 있는 전문가 — 정보 보완(빈 항목만) + 자사 관계 추가
  | "already" // 이미 자사와 관계가 있음 — 건너뜀
  | "dup_file" // 파일 안 중복
  | "error";

export const DIRECT_IMPORT_STATUS_LABELS: Record<DirectImportRowStatus, string> = {
  create: "신규 가입·등록",
  link: "기존 전문가 — 관계 추가",
  already: "이미 등록됨 — 건너뜀",
  dup_file: "파일 안 중복",
  error: "오류",
};

export type DirectImportPreviewRow = {
  index: number;
  input: DirectImportRowInput;
  phoneE164: string | null;
  status: DirectImportRowStatus;
  message: string | null;
  /** 쉼표 분리된 분야 (trim, 빈 값 제거) */
  expertiseFields: string[];
  /**
   * 재확인 대조 (기획 2026-08-30 — 24번): 휴대폰은 다르지만 이름 또는
   * 이메일이 기존 전문가와 겹친다 — 신규 생성은 가능하되 확정 전에 한 번 더
   * 확인받는다 (번호가 바뀐 동일인일 수 있다).
   */
  similarMatch: string | null;
};

/** 이름·이메일 대조용 색인 (기획 2026-08-30 — 24번) */
export type SimilarLookup = {
  names: ReadonlySet<string>;
  emails: ReadonlySet<string>;
};

export function splitExpertiseFields(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,，、]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && v.length <= 30)
    )
  );
}

/**
 * 업로드 행 분류 — 서버에서 커밋 직전에도 같은 함수로 재판정한다.
 * existingPhones: 전역 experts에 이미 있는 번호 / linkedPhones: 자사 관계가
 * 이미 있는 번호 (둘 다 E.164).
 */
export function classifyDirectImportRows(
  rawRows: Record<string, string>[],
  existingPhones: ReadonlySet<string>,
  linkedPhones: ReadonlySet<string>,
  similar?: SimilarLookup
): DirectImportPreviewRow[] {
  const seen = new Set<string>();
  return rawRows.map((raw, index) => {
    const input: DirectImportRowInput = {
      name: (raw.name ?? "").trim(),
      organization: (raw.organization ?? "").trim(),
      jobTitle: (raw.jobTitle ?? "").trim(),
      email: (raw.email ?? "").trim(),
      phone: restoreLeadingZero((raw.phone ?? "").trim()),
      bankName: (raw.bankName ?? "").trim(),
      accountNumber: restoreLeadingZero((raw.accountNumber ?? "").trim()),
      accountHolder: (raw.accountHolder ?? "").trim(),
      residence: (raw.residence ?? "").trim(),
      degreeCertifications: (raw.degreeCertifications ?? "").trim(),
      expertiseFieldsText: (raw.expertiseFieldsText ?? "").trim(),
      bio: (raw.bio ?? "").trim(),
    };
    const expertiseFields = splitExpertiseFields(input.expertiseFieldsText);

    const parsed = directImportRowSchema.safeParse(input);
    if (!parsed.success) {
      return {
        index,
        input,
        phoneE164: null,
        status: "error" as const,
        message: parsed.error.issues[0]?.message ?? "입력값 오류",
        expertiseFields,
        similarMatch: null,
      };
    }

    const phoneE164 = normalizeKrMobileE164(input.phone);
    if (!phoneE164) {
      return {
        index,
        input,
        phoneE164: null,
        status: "error" as const,
        message: "올바른 휴대폰 번호가 아닙니다",
        expertiseFields,
        similarMatch: null,
      };
    }

    if (seen.has(phoneE164)) {
      return {
        index,
        input,
        phoneE164,
        status: "dup_file" as const,
        message: "같은 번호가 파일에 먼저 나옵니다",
        expertiseFields,
        similarMatch: null,
      };
    }
    seen.add(phoneE164);

    if (linkedPhones.has(phoneE164)) {
      return {
        index,
        input,
        phoneE164,
        status: "already" as const,
        message: "이미 우리 회사와 관계가 있는 전문가입니다",
        expertiseFields,
        similarMatch: null,
      };
    }

    if (existingPhones.has(phoneE164)) {
      return {
        index,
        input,
        phoneE164,
        status: "link" as const,
        message: "캐스트로그에 이미 있는 전문가 — 정보는 덮어쓰지 않고 관계만 추가합니다",
        expertiseFields,
        similarMatch: null,
      };
    }

    // 휴대폰은 새 번호지만 이름·이메일이 기존 전문가와 겹치는 경우 —
    // 번호가 바뀐 동일인일 수 있다. 신규 생성은 막지 않되 재확인을 요구한다
    // (기획 2026-08-30 — 24번).
    const nameHit = similar?.names.has(input.name) ?? false;
    const emailHit =
      input.email !== "" &&
      (similar?.emails.has(input.email.toLowerCase()) ?? false);
    // '캐스트로그 등록플랫폼 전체' 기준 대조다 — "우리 회사 전문가"로
    // 오독하지 않게 문구에 범위를 명시한다 (리뷰 P3-4)
    const similarMatch =
      nameHit || emailHit
        ? `캐스트로그에 ${[nameHit ? "이름" : null, emailHit ? "이메일" : null]
            .filter(Boolean)
            .join("·")}이 같은 전문가가 이미 등록되어 있습니다 (휴대폰은 다름) — 번호가 바뀐 동일인인지 확인 후 등록하세요`
        : null;

    return {
      index,
      input,
      phoneE164,
      status: "create" as const,
      message: similarMatch,
      expertiseFields,
      similarMatch,
    };
  });
}
