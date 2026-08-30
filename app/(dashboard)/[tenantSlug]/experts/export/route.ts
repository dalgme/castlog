import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import {
  EXPERT_EXPORT_COLUMNS,
  loadExpertExportRows,
} from "@/lib/experts/list-export";

/**
 * 전문가 목록 엑셀 내보내기 — 화면 테이블과 같은 정보량 (기획 2026-08-30 — 25번).
 * 컬럼 정의는 lib/experts/list-export.ts EXPERT_EXPORT_COLUMNS 한 곳이다 —
 * 목록 테이블이 바뀌면 거기에 한 줄 추가하면 엑셀에 반영된다.
 * 민감 서류·주민번호·계좌는 포함하지 않는다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/experts`, request.url)
    );
  }

  const exportRows = await loadExpertExportRows();
  const rows = exportRows.map((r) =>
    Object.fromEntries(
      EXPERT_EXPORT_COLUMNS.map((col) => [col.header, col.value(r)])
    )
  );

  const supabase = createClient();
  await logAudit(supabase, user, {
    action: "export.experts",
    resourceType: "export",
    afterData: { rows: rows.length },
  });

  return xlsxResponse("전문가목록", [["전문가", rows]]);
}
