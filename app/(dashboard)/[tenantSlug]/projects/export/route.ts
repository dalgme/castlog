import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PROJECT_STATUS_LABELS } from "@/lib/operations/steps";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";

/** 프로젝트 목록 엑셀 내보내기 — 사업연도 축 포함 (CLAUDE.md 12-7) */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  // 프로젝트 내보내기는 공통 기반 — 모듈 게이트 없음
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/projects`, request.url)
    );
  }

  const supabase = createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select(
      "name, code, business_year, client_name, status, starts_on, ends_on, project_lifecycle_steps (status)"
    )
    // 보관(취소) 건은 목록과 동일하게 제외 — 화면과 엑셀이 달라지면 안 된다 (리뷰 5)
    .neq("status", "cancelled")
    .order("business_year", { ascending: false })
    .order("created_at", { ascending: false });

  const rows = (projects ?? []).map((project) => {
    const steps = project.project_lifecycle_steps ?? [];
    const done = steps.filter(
      (s) => s.status === "completed" || s.status === "skipped"
    ).length;
    return {
      사업연도: project.business_year,
      프로젝트명: project.name,
      관리코드: project.code ?? "",
      발주처: project.client_name ?? "",
      시작일: project.starts_on ?? "",
      종료일: project.ends_on ?? "",
      상태: PROJECT_STATUS_LABELS[project.status] ?? project.status,
      스텝진행: steps.length > 0 ? `${done}/${steps.length}` : "",
    };
  });

  await logAudit(supabase, user, {
    action: "export.projects",
    resourceType: "export",
    afterData: { rows: rows.length },
  });

  return xlsxResponse("프로젝트목록", [["프로젝트", rows]]);
}
