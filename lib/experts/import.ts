import { z } from "zod";

import { normalizeKrMobileE164 } from "@/lib/auth/phone";

/**
 * 전문가 엑셀 일괄 가져오기 — 검증 규칙 (설계문서 7.10)
 *
 * 전문가 신원 모델(v1.2)상 experts 레코드는 본인만 생성할 수 있으므로,
 * 일괄 가져오기는 등록 요청(expert_invitations)을 행 단위로 생성해
 * /j 링크를 대량 발급하는 방식이다. 전문분야·경력 등 프로필은
 * 전문가 본인이 등록 시 직접 입력한다.
 */

/** 템플릿 컬럼 (순서 고정) */
export const IMPORT_HEADERS = ["이름", "휴대폰"] as const;

/** 업로드 상한 — 초과분은 나눠서 올리도록 안내 */
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const importRowSchema = z.object({
  name: z
    .string()
    .min(1, "이름을 입력하세요.")
    .max(50, "이름은 50자 이내여야 합니다."),
  phone: z.string().min(1, "휴대폰 번호를 입력하세요."),
});

/**
 * 엑셀이 휴대폰을 숫자로 저장해 앞자리 0이 사라진 값 복원.
 * "1055551234" → "01055551234" (E.164 정규화는 이후 별도 수행)
 */
export function restoreLeadingZero(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (/^1[016789]\d{7,8}$/.test(digits)) {
    return `0${digits}`;
  }
  return value;
}

export type ImportRowStatus =
  | "ok" // 등록 요청 생성 대상
  | "error" // 검증 실패 — 제외
  | "dup_file" // 파일 내 중복 — 첫 행만 처리
  | "dup_linked" // 이미 연결된 전문가 — 제외
  | "dup_pending"; // 대기중 등록 요청 존재 — 중복 처리 방식에 따름

export type ImportPreviewRow = {
  /** 엑셀 행 번호 (헤더 제외, 1부터) */
  rowNumber: number;
  name: string;
  /** 원본 입력값 (오류 표시용) */
  phoneInput: string;
  /** E.164 정규화 결과 (유효할 때만) */
  phone: string | null;
  status: ImportRowStatus;
  message: string;
};

export const IMPORT_STATUS_LABEL: Record<ImportRowStatus, string> = {
  ok: "등록 대상",
  error: "오류",
  dup_file: "파일 내 중복",
  dup_linked: "이미 연결됨",
  dup_pending: "요청 대기중",
};

/** 중복(대기중 요청) 처리 방식 */
export type ImportDupMode = "skip" | "reissue";

/**
 * 파싱된 행들을 검증하고 상태를 부여한다.
 * linkedPhones/pendingPhones는 호출자(서버)가 RLS 범위에서 조회해 넘긴다.
 */
export function classifyImportRows(
  rawRows: { name: string; phone: string }[],
  linkedPhones: ReadonlySet<string>,
  pendingPhones: ReadonlySet<string>
): ImportPreviewRow[] {
  const seenInFile = new Set<string>();

  return rawRows.map((raw, index) => {
    const rowNumber = index + 1;
    const name = raw.name.trim();
    const phoneInput = raw.phone.trim();

    const parsed = importRowSchema.safeParse({ name, phone: phoneInput });
    if (!parsed.success) {
      return {
        rowNumber,
        name,
        phoneInput,
        phone: null,
        status: "error" as const,
        message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
      };
    }

    const phone = normalizeKrMobileE164(restoreLeadingZero(phoneInput));
    if (!phone) {
      return {
        rowNumber,
        name,
        phoneInput,
        phone: null,
        status: "error" as const,
        message: "올바른 휴대폰 번호가 아닙니다 (예: 010-1234-5678).",
      };
    }

    if (seenInFile.has(phone)) {
      return {
        rowNumber,
        name,
        phoneInput,
        phone,
        status: "dup_file" as const,
        message: "파일 안에 같은 번호가 먼저 있습니다. 첫 행만 처리됩니다.",
      };
    }
    seenInFile.add(phone);

    if (linkedPhones.has(phone)) {
      return {
        rowNumber,
        name,
        phoneInput,
        phone,
        status: "dup_linked" as const,
        message: "이미 우리 회사와 연결된 전문가입니다.",
      };
    }

    if (pendingPhones.has(phone)) {
      return {
        rowNumber,
        name,
        phoneInput,
        phone,
        status: "dup_pending" as const,
        message: "대기중인 등록 요청이 이미 있습니다.",
      };
    }

    return {
      rowNumber,
      name,
      phoneInput,
      phone,
      status: "ok" as const,
      message: "",
    };
  });
}
