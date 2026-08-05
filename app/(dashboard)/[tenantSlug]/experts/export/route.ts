import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { xlsxResponse } from "@/lib/exports/xlsx";
import { logAudit } from "@/lib/audit/log";

const LINK_STATUS: Record<string, string> = {
  active: "연결됨",
  pending: "대기중",
  revoked: "해제됨",
};

/** 전문가 목록 엑셀 내보내기 — RLS(자사 연결) 범위. 민감 서류·번호는 포함하지 않는다. */
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

  const supabase = createClient();
  const { data: links } = await supabase
    .from("expert_tenant_links")
    .select(
      "status, accepted_at, experts (name, phone, email, specialty, region, career_years)"
    )
    .order("created_at", { ascending: false });

  const rows = (links ?? [])
    .filter((link) => link.experts)
    .map((link) => ({
      이름: link.experts!.name,
      휴대폰: formatKrMobile(link.experts!.phone),
      이메일: link.experts!.email ?? "",
      전문분야: link.experts!.specialty ?? "",
      지역: link.experts!.region ?? "",
      "경력(년)": link.experts!.career_years ?? "",
      연결상태: LINK_STATUS[link.status] ?? link.status,
      연결일: link.accepted_at ? link.accepted_at.slice(0, 10) : "",
    }));

  await logAudit(supabase, user, {
    action: "export.experts",
    resourceType: "export",
    afterData: { rows: rows.length },
  });

  return xlsxResponse("전문가목록", [["전문가", rows]]);
}
