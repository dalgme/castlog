import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { xlsxResponse } from "@/lib/exports/xlsx";

const ROLE_LABELS: Record<string, string> = {
  org_admin: "기업총괄관리자",
  manager: "관리자",
  staff: "직원",
};

/** 직원 목록 엑셀 내보내기 (기업총괄관리자) */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string } }
) {
  await requireRole(["org_admin", "platform_admin"]);
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/admin/org`, request.url)
    );
  }

  const supabase = createClient();
  const { data: staff } = await supabase
    .from("users")
    .select("name, email, role, department, is_active, created_at, positions (name)")
    .order("created_at", { ascending: true });

  const rows = (staff ?? []).map((member) => ({
    이름: member.name,
    이메일: member.email,
    역할: ROLE_LABELS[member.role] ?? member.role,
    부서: member.department ?? "",
    직급: member.positions?.name ?? "",
    상태: member.is_active ? "활성" : "비활성",
    등록일: member.created_at.slice(0, 10),
  }));

  return xlsxResponse("직원목록", [["직원", rows]]);
}
