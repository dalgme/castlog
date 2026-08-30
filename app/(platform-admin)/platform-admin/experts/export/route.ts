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
  // 비관리자는 requireRole이 리다이렉트한다. env 부재(빌드 환경)만 null 반환
  const user = await requireRole(["platform_admin"]);
  if (!user || !hasSupabaseEnv()) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = createAdminClient();
  // PostgREST 기본 상한(1000행)에 조용히 잘리지 않게 range로 전량 수집 (리뷰 9)
  const experts: {
    name: string;
    phone: string;
    email: string | null;
    organization: string | null;
    job_title: string | null;
    specialty: string | null;
    region: string | null;
    career_years: number | null;
    auth_user_id: string | null;
    is_active: boolean;
    created_at: string;
  }[] = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data: page } = await admin
      .from("experts")
      .select(
        "name, phone, email, organization, job_title, specialty, region, career_years, auth_user_id, is_active, created_at"
      )
      .eq("is_practice", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }) // 동률·수집 중 삽입에 대한 안정 정렬 (리뷰 15)
      .range(from, from + CHUNK - 1);
    experts.push(...(page ?? []));
    if (!page || page.length < CHUNK) break;
  }

  const rows = experts.map((e) => ({
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
  const { error: auditError } = await admin.from("audit_logs").insert({
    tenant_id: null,
    actor_auth_user_id: user.id,
    actor_role: "platform_admin",
    action: "export.experts_global",
    resource_type: "export",
    resource_id: null,
    after_data: { rows: rows.length },
  });
  if (auditError) {
    console.warn("[experts-export] audit insert failed:", auditError.code);
  }

  return xlsxResponse("전문가DB", [["전문가", rows]]);
}
