import "server-only";

import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

/**
 * 엑셀 내보내기 공통 (CLAUDE.md 12-6 — 새 목록 화면은 엑셀 내보내기 고려)
 *
 * - 세션(RLS) 권한 안에서 조회된 데이터만 담는다 — 라우트 핸들러에서 호출.
 * - 주민등록번호 등 민감정보 컬럼은 어떤 내보내기에도 포함하지 않는다.
 */

export type SheetRows = Record<string, string | number | null>[];

/** 워크북 생성 → XLSX 응답. sheets: [시트명, 행배열] 목록 */
export function xlsxResponse(
  filenameBase: string,
  sheets: [string, SheetRows][]
): NextResponse {
  const workbook = XLSX.utils.book_new();

  for (const [sheetName, rows] of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    // 열 너비 자동 추정 (문자폭 근사)
    const firstRow = rows[0];
    if (firstRow) {
      const headers = Object.keys(firstRow);
      worksheet["!cols"] = headers.map((header) => {
        const maxLen = Math.max(
          header.length * 2,
          ...rows.map((row) => String(row[header] ?? "").length + 2)
        );
        return { wch: Math.min(40, Math.max(10, maxLen)) };
      });
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  }

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const date = new Date().toISOString().slice(0, 10);
  const encoded = encodeURIComponent(`${filenameBase}_${date}.xlsx`);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export_${date}.xlsx"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
