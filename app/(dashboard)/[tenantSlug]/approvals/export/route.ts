import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
} from "@/lib/approvals/constants";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";

/** 결재 목록 엑셀 내보내기 — RLS 범위(상신자·결재 참여·총괄관리자) */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("approvals");
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/approvals`, request.url)
    );
  }

  const supabase = createClient();
  const { data: approvals } = await supabase
    .from("approvals")
    .select(
      "title, approval_type, amount, status, created_at, completed_at, users!approvals_requester_user_id_fkey (name), projects (name)"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows = (approvals ?? []).map((approval) => ({
    제목: approval.title,
    유형: APPROVAL_TYPE_LABELS[approval.approval_type] ?? approval.approval_type,
    "금액(원)": approval.amount ?? "",
    상신자: approval.users?.name ?? "",
    프로젝트: approval.projects?.name ?? "",
    상태: APPROVAL_STATUS_LABELS[approval.status] ?? approval.status,
    상신일: approval.created_at.slice(0, 10),
    종결일: approval.completed_at ? approval.completed_at.slice(0, 10) : "",
  }));

  await logAudit(supabase, user, {
    action: "export.approvals",
    resourceType: "export",
    afterData: { rows: rows.length },
  });

  return xlsxResponse("결재목록", [["결재", rows]]);
}
