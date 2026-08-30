import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { xlsxResponse } from "@/lib/exports/xlsx";

export const dynamic = "force-dynamic";

/**
 * 전역 전문가 DB 엑셀 내보내기 (관리모드 — §12-6).
 * 공개 프로필 컬럼만 싣는다. 민감정보(주민번호·계좌·서류)와 테넌트 격리
 * 데이터(평가·이력)는 어떤 내보내기에도 포함하지 않는다.
 */
export async function GET() {
  const user = await requireRole(["platform_admin"]);
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL("/platform-admin/experts", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
    );
  }

  const admin = createAdminClient();
  const { data: experts } = await admin
    .from("experts")
    .select(
      "name, phone, email, organization, job_title, specialty, region, career_years, auth_user_id, is_active, created_at"
    )
    .eq("is_practice", false)
    .order("created_at", { ascending: false });

  const rows = (experts ?? []).map((e) => ({
    이름: e.name,
    휴대폰: formatKrMobile(e.phone),
    이메일: e.email ?? "",
    소속: e.organization ?? "",
    직위: e.job_title ?? "",
    전문분야: e.specialty ?? "",
    지역: e.region ?? "",
    "경력(년)": e.career_years,
    계정연결: e.auth_user_id ? "연결됨" : "미연결",
    상태: e.is_active ? "활성" : "이용 중지",
    등록일: new Date(e.created_at).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
    }),
  }));

  // 전역 반출 — tenant_id 없이 기록 (audit_logs.tenant_id nullable 설계)
  await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: user.id,
    actor_role: "platform_admin",
    action: "export.experts_global",
    resource_type: "export",
    resource_id: null,
    after_data: { rows: rows.length },
  });

  return xlsxResponse("전문가DB", [["전문가", rows]]);
}
