import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { canViewSecurity } from "@/lib/auth/admin-scopes";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";
import { auditActionLabel, auditRoleLabel } from "@/lib/audit/labels";

const EXPORT_LIMIT = 5000;

/**
 * 감사로그 엑셀 내보내기 — 보안 점검 보고서용 (대표 또는 audit 위임자).
 * 화면과 같은 필터를 그대로 받는다. 내보내기 행위도 감사로그에 남긴다.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasSupabaseEnv() || !(await canViewSecurity())) {
    return new NextResponse("감사로그 열람 권한이 없습니다.", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const category = sp.get("category") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const q = sp.get("q") ?? "";

  const supabase = createClient();
  let query = supabase
    .from("audit_logs")
    .select(
      "action, resource_type, resource_id, actor_auth_user_id, actor_role, after_data, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);

  if (category) query = query.like("action", `${category}.%`);
  if (from) query = query.gte("created_at", `${from}T00:00:00+09:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59+09:00`);
  if (q) query = query.or(`action.ilike.%${q}%,resource_type.ilike.%${q}%`);

  const [{ data: logs }, { data: staff }] = await Promise.all([
    query,
    supabase.from("users").select("id, name"),
  ]);
  const nameByUserId = new Map((staff ?? []).map((u) => [u.id, u.name]));
  const rows = logs ?? [];

  const sheet = rows.map((log) => ({
    시각: new Date(log.created_at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
    }),
    행위자:
      (log.actor_auth_user_id && nameByUserId.get(log.actor_auth_user_id)) ??
      auditRoleLabel(log.actor_role),
    권한: auditRoleLabel(log.actor_role),
    행위: auditActionLabel(log.action),
    "행위 코드": log.action,
    대상: log.resource_type,
    "대상 ID": log.resource_id ?? "",
    내용: log.after_data ? JSON.stringify(log.after_data) : "",
  }));

  await logAudit(supabase, user, {
    action: "export.audit_logs",
    resourceType: "export",
    afterData: {
      rows: sheet.length,
      category: category || null,
      from: from || null,
      to: to || null,
    },
  });

  return xlsxResponse("감사로그", [["감사로그", sheet]]);
}
