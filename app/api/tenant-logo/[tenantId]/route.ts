import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { TENANT_LOGO_BUCKET } from "@/lib/branding/tenant-logo";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 공개 회사 로고 — 로그인 없이 열리는 화면(공개 링크·수락서)에서 쓴다.
 *
 * 왜 공개인가: 로고는 명함·현수막·홈페이지에 이미 쓰는 **공개 브랜드 자산**이다.
 * 반면 전문가가 보는 화면은 로그인 없이 열리는 것이 대부분이라(섭외 동의 링크,
 * 서류 제출 링크), 인증을 요구하면 그 화면에서는 회사 로고를 영영 쓸 수 없다.
 *
 * 대신 이 경로는 **로고 바이트만** 내보낸다. 회사 이름·상태·설정은 실리지 않으며,
 * tenantId를 안다고 다른 것을 얻을 수 없다.
 */
export async function GET(
  _request: Request,
  { params }: { params: { tenantId: string } }
) {
  if (!hasSupabaseEnv()) return new NextResponse(null, { status: 404 });
  if (!UUID.test(params.tenantId)) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("logo_url, status")
    .eq("id", params.tenantId)
    .maybeSingle();

  // 해지된 테넌트의 로고는 더 이상 내보내지 않는다
  if (!tenant?.logo_url || tenant.status === "terminated") {
    return new NextResponse(null, { status: 404 });
  }
  if (!tenant.logo_url.startsWith(`tenant-logos/${params.tenantId}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  const { data: file } = await admin.storage
    .from(TENANT_LOGO_BUCKET)
    .download(tenant.logo_url);
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}
