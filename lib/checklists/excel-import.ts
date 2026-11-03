import * as XLSX from "xlsx";

import { isChecklistKind, type ChecklistKind } from "@/lib/checklists/kinds";

/**
 * 체크리스트 엑셀 자동 해석 (기획 지시 2026-11-03).
 *
 * 회사가 쓰던 엑셀을 그대로 올리면 시트마다 머리글 행을 찾아 열을 짝지어 항목으로 만든다.
 * 캐스트로그가 내보낸 형식(시기·구분·세부 분류·업무 내용·권장(D±)·담당·마감일 계획·완료일·
 * 참고사항·메모)은 물론, 비슷한 머리글(내용·항목·할 일·D-Day·비고 등)도 받는다.
 * 병합 셀로 비어 있는 시기·구분·세부 분류는 바로 위 값을 이어받는다.
 * 서버·클라이언트 공용 — 서버 전용 import 금지. 파일 읽기는 서버 액션에서 한다.
 */

export type ParsedChecklistItem = {
  phase: string | null;
  category: string | null;
  subcategory: string | null;
  title: string;
  offsetDays: number | null;
  quantity: string | null;
  note: string | null;
  assigneeName: string | null;
  plannedDue: string | null;
  completedOn: string | null;
  check1: string | null;
  check2: string | null;
  decision: string | null;
  applicable: string | null;
  memo: string | null;
};

export type ParsedChecklistSheet = {
  sheetName: string;
  /** 시트 이름·열 구성으로 추정한 종류. 확신이 없으면 null (호출한 쪽의 기본 종류를 쓴다) */
  kind: ChecklistKind | null;
  items: ParsedChecklistItem[];
  /** 짝지어진 열 — 결과 안내용 */
  matchedColumns: string[];
  warnings: string[];
};

type Field = keyof ParsedChecklistItem;

/** 머리글 동의어 — 앞뒤 공백·괄호 안 부연·개행을 지우고 비교한다 */
const HEADER_SYNONYMS: Record<Field, string[]> = {
  phase: ["시기", "단계", "시점", "구분(시기)", "행사전후"],
  category: ["구분", "사업분류", "사업 분류", "분류", "카테고리", "대분류", "영역"],
  subcategory: ["세부분류", "세부 분류", "소분류", "세부구분", "세부 구분", "하위분류"],
  title: ["업무내용", "업무 내용", "확인내용", "확인 내용", "진행내용", "진행 내용", "항목", "내용", "할일", "할 일", "체크항목", "체크 항목", "체크리스트", "실행목록", "실행 목록", "물품명", "물품 명", "품목", "품명", "준비물", "물품", "업무", "작업", "task", "item"],
  offsetDays: ["권장", "권장(d±)", "권장 d±", "d±", "d-day", "dday", "디데이", "권장일", "권장마감", "권장 마감", "기준일", "d"],
  quantity: ["수량", "개수", "qty"],
  note: ["참고사항", "참고 사항", "비고", "참고", "진행내용(메모)", "진행 내용(메모)", "설명", "remark", "note"],
  assigneeName: ["담당", "담당자", "책임자", "담당 자", "owner"],
  plannedDue: ["마감일계획", "마감일 계획", "마감일", "마감", "기한", "계획일", "due"],
  completedOn: ["완료일", "완료 일", "완료", "완료일자", "done"],
  check1: ["1차확인", "1차 확인", "1차확인(d-25)", "1차 확인 (d-25)", "발주기관특이사항", "발주기관 특이사항", "1차"],
  check2: ["최종확인", "최종 확인", "최종확인(d-10)", "최종 확인 (d-10)", "최종확인(d-2)", "최종 확인 (d-2)", "운영기관특이사항", "운영기관 특이사항", "최종"],
  decision: ["결정사항", "결정 사항", "최종점검사항", "최종 점검 사항", "점검사항", "결정"],
  applicable: ["해당사항", "해당 사항", "해당", "적용"],
  memo: ["메모", "memo"],
};

/** 권장 마감일 열 — 'D-25' 같은 표기는 날짜가 아니라 상대값이다. 내보내기의 '권장 마감일'(실제 날짜)은 건너뛴다 */
const IGNORED_HEADERS = ["no", "no.", "번호", "순번", "#", "권장마감일", "권장 마감일"];

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function headerKey(v: unknown): string {
  return norm(v).toLowerCase().replace(/\s+/g, "").replace(/[()（）\[\]:：·.]/g, (m) => (m === "(" || m === "（" ? "(" : m === ")" || m === "）" ? ")" : ""));
}

function matchHeader(raw: unknown): Field | "ignore" | null {
  const k = headerKey(raw);
  if (!k) return null;
  if (IGNORED_HEADERS.some((h) => headerKey(h) === k)) return "ignore";
  // 정확히 같은 것 먼저, 그 다음 포함
  for (const [field, syns] of Object.entries(HEADER_SYNONYMS) as [Field, string[]][]) {
    if (syns.some((s) => headerKey(s) === k)) return field;
  }
  for (const [field, syns] of Object.entries(HEADER_SYNONYMS) as [Field, string[]][]) {
    if (syns.some((s) => s.length >= 2 && k.includes(headerKey(s)))) return field;
  }
  return null;
}

/** 'D-25' · 'D+3' · '-25' · '25' · 'D-Day' → 일수. 아니면 null */
export function parseOffsetDays(raw: unknown): number | null {
  const s = norm(raw).toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^D-?DAY$/.test(s) || s === "D" || s === "D0" || s === "D+0" || s === "D-0") return 0;
  const m = s.match(/^D?([+\-−–])?(\d{1,3})(일)?$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  const sign = m[1] === "+" || m[1] === undefined ? 1 : -1;
  // 'D25'처럼 부호가 없으면 관례상 사전(마이너스)으로 본다 — 체크리스트 권장일은 거의 행사 전이다
  return m[1] === undefined && s.startsWith("D") ? -n : sign * n;
}

/** 엑셀 날짜(일련번호·문자열) → yyyy-mm-dd. 아니면 null */
export function parseExcelDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = norm(raw);
  const m = s.match(/^(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/** 시트 이름·열로 종류 추정 */
export function guessKind(sheetName: string, fields: Set<Field>): ChecklistKind | null {
  const n = sheetName.replace(/\s+/g, "");
  if (/착수/.test(n)) return "kickoff";
  if (/마감/.test(n)) return "deadline";
  if (/숙소|강의장|대관|행사장/.test(n)) return "venue";
  if (/준비물|물품|비품/.test(n)) return "supplies";
  if (/유형/.test(n)) return "typed";
  if (/공통|체크리스트|checklist/i.test(n)) return "common";
  if (fields.has("quantity")) return "supplies";
  if (fields.has("applicable")) return "kickoff";
  if (fields.has("decision") && fields.has("check1")) return "venue";
  return null;
}

function cellText(v: unknown): string | null {
  if (v instanceof Date) return parseExcelDate(v);
  const s = norm(v);
  return s ? s : null;
}

/**
 * 한 시트 해석. 머리글 행 = 짝지어지는 열이 2개 이상이고 그중 하나가 '내용(title)'인 첫 행.
 * 머리글을 못 찾으면 첫 행을 머리글로 보고 글자가 가장 긴 열을 내용으로 삼는다.
 */
export function parseChecklistSheet(sheetName: string, sheet: XLSX.WorkSheet): ParsedChecklistSheet | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  if (rows.length === 0) return null;

  // 내보내기의 '프로젝트 정보' 시트(항목/값) 등 두 열짜리 정보 표는 건너뛴다
  const warnings: string[] = [];
  let headerIndex = -1;
  let mapping = new Map<number, Field>();
  for (let r = 0; r < Math.min(rows.length, 15); r += 1) {
    const row = rows[r] ?? [];
    const m = new Map<number, Field>();
    row.forEach((cell, c) => {
      const f = matchHeader(cell);
      if (f && f !== "ignore" && !Array.from(m.values()).includes(f)) m.set(c, f);
    });
    if (m.size >= 2 && Array.from(m.values()).includes("title")) {
      headerIndex = r;
      mapping = m;
      break;
    }
  }
  if (headerIndex < 0) {
    const first = rows[0] ?? [];
    const twoCols = rows.every((r) => (r ?? []).filter((c) => norm(c)).length <= 2);
    const infoHeader = ["항목", "값", "key", "value", "필드"].includes(headerKey(first[0])) || ["값", "value"].includes(headerKey(first[1]));
    // 내보내기의 '프로젝트 정보'(항목/값)나 짧은 두 열짜리 메모 표는 체크리스트가 아니다
    if (twoCols && (infoHeader || rows.length <= 12)) return null;
    // 폴백: 첫 행 머리글, 아직 짝지어지지 않은 열 중 본문 글자 수가 가장 긴 열이 내용
    headerIndex = 0;
    mapping = new Map<number, Field>();
    first.forEach((cell, c) => {
      const f = matchHeader(cell);
      if (f && f !== "ignore" && !Array.from(mapping.values()).includes(f)) mapping.set(c, f);
    });
    if (!Array.from(mapping.values()).includes("title")) {
      const body = rows.slice(1);
      const colCount = Math.max(...rows.map((r) => (r ?? []).length));
      let best = -1;
      let bestLen = 0;
      for (let c = 0; c < colCount; c += 1) {
        if (mapping.has(c)) continue;
        const len = body.reduce((s, r) => s + norm((r ?? [])[c]).length, 0);
        if (len > bestLen) {
          bestLen = len;
          best = c;
        }
      }
      if (best < 0) return null;
      mapping.set(best, "title");
      warnings.push(`'${sheetName}' 시트는 머리글을 확실히 알 수 없어 ${best + 1}번째 열을 내용으로 읽었습니다.`);
    }
  }

  const titleCol = Array.from(mapping.entries()).find(([, f]) => f === "title")?.[0];
  if (titleCol === undefined) return null;

  const items: ParsedChecklistItem[] = [];
  // 병합 셀 이어받기 — 시기 > 구분 > 세부 분류 순서. 위 단계가 바뀌면 아래 단계의 이어받기는 끊는다
  const HIERARCHY = ["phase", "category", "subcategory"] as const;
  const carry: Partial<Record<(typeof HIERARCHY)[number], string | null>> = {};
  const colOf = (f: Field) => Array.from(mapping.entries()).find(([, v]) => v === f)?.[0];
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const title = cellText(row[titleCol]);
    if (!title) continue;
    // 머리글이 본문 중간에 반복되면(병합 표) 건너뛴다
    if (matchHeader(title) === "title") continue;
    const item: ParsedChecklistItem = {
      phase: null, category: null, subcategory: null, title, offsetDays: null, quantity: null, note: null,
      assigneeName: null, plannedDue: null, completedOn: null, check1: null, check2: null, decision: null,
      applicable: null, memo: null,
    };
    for (let h = 0; h < HIERARCHY.length; h += 1) {
      const f = HIERARCHY[h] as (typeof HIERARCHY)[number];
      const c = colOf(f);
      if (c === undefined) continue;
      const v = cellText(row[c]);
      if (v) {
        if (v !== carry[f]) for (const lower of HIERARCHY.slice(h + 1)) carry[lower] = null;
        carry[f] = v;
      }
      item[f] = v ?? carry[f] ?? null;
    }
    for (const [c, f] of Array.from(mapping.entries())) {
      if (f === "title" || (HIERARCHY as readonly string[]).includes(f)) continue;
      const raw = row[c];
      switch (f) {
        case "offsetDays": item.offsetDays = parseOffsetDays(raw); break;
        case "plannedDue": item.plannedDue = parseExcelDate(raw); break;
        case "completedOn": item.completedOn = parseExcelDate(raw); break;
        default: {
          const v = cellText(raw);
          (item as Record<Field, unknown>)[f] = v;
        }
      }
    }
    items.push(item);
  }
  if (items.length === 0) return null;

  const fields = new Set(mapping.values());
  const header = rows[headerIndex] ?? [];
  const matchedColumns = Array.from(mapping.entries()).map(([c]) => norm(header[c]) || `${c + 1}열`);
  return { sheetName, kind: guessKind(sheetName, fields), items, matchedColumns, warnings };
}

/** 통합 문서 전체 — 해석되는 시트만 돌려준다 */
export function parseChecklistWorkbook(data: Uint8Array): { sheets: ParsedChecklistSheet[]; skipped: string[] } {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheets: ParsedChecklistSheet[] = [];
  const skipped: string[] = [];
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const parsed = parseChecklistSheet(name, ws);
    if (parsed) sheets.push(parsed);
    else skipped.push(name);
  }
  return { sheets, skipped };
}

export function kindOrDefault(k: ChecklistKind | null, fallback: ChecklistKind): ChecklistKind {
  return k && isChecklistKind(k) ? k : fallback;
}
