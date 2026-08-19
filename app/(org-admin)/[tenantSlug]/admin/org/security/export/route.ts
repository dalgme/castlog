import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { canViewSecurity } from "@/lib/auth/admin-scopes";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import {
  rrnAccessReasonLabel,
  rrnAccessTypeLabel,
} from "@/lib/integrations/rrn-access";

/**
 * 주민등록번호 조회 이력 엑셀 — 보안 점검 보고서용 (대표 또는 audit 위임자).
 *
 * 이 파일에는 번호가 들어가지 않는다. '누가·언제·왜 조회했는가'만 담는다.
 * 내보내기 자체도 조회 행위이므로 감사로그에 남긴다 (CLAUDE.md §12-4).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasSupabaseEnv() || !(await canViewSecurity())) {
    return new NextResponse("보안 기록 열람 권한이 없습니다.", { status: 403 });
  }

  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";

  const supabase = createClient();
  let query = supabase
    .from("tax_access_logs")
    .select(
      "expert_id, project_name, reason, access_type, accessor_label, accessed_at, is_over_limit, over_limit_reason"
    )
    .order("accessed_at", { ascending: false })
    .limit(5000);
  if (from) query = query.gte("accessed_at", `${from}T00:00:00+09:00`);
  if (to) query = query.lte("accessed_at", `${to}T23:59:59+09:00`);

  const { data: logs } = await query;
  const rows = logs ?? [];

  const expertIds = Array.from(new Set(rows.map((r) => r.expert_id)));
  const { data: experts } =
    expertIds.length > 0
      ? await supabase.from("experts").select("id, name").in("id", expertIds)
      : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((experts ?? []).map((e) => [e.id, e.name]));

  const sheet = rows.map((r) => ({
    "조회 일시": new Date(r.accessed_at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
    }),
    전문가: nameById.get(r.expert_id) ?? "전문가",
    프로젝트: r.project_name ?? "프로젝트 미연결",
    사유: rrnAccessReasonLabel(r.reason),
    형태: rrnAccessTypeLabel(r.access_type),
    조회자: r.accessor_label ?? "",
    "한도 초과": r.is_over_limit ? "예" : "아니오",
    "초과 사유": r.over_limit_reason ?? "",
  }));

  await logAudit(supabase, user, {
    action: "export.rrn_access_logs",
    resourceType: "export",
    afterData: { rows: sheet.length, from: from || null, to: to || null },
  });

  return xlsxResponse("주민번호조회이력", [["조회이력", sheet]]);
}
