import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { tenantIdFromUser } from "@/lib/auth/tenant";
import { TENANT_LOGO_BUCKET } from "@/lib/branding/tenant-logo";

export const dynamic = "force-dynamic";

/**
 * 회사 로고 이미지 — 로그인한 자사 사용자에게만.
 *
 * 공개 URL을 만들지 않기 위한 통로다. 경로는 JWT의 tenant_id로만 정해지고,
 * 요청에서 테넌트를 받지 않는다 — 남의 회사 로고를 요청할 방법 자체를 없앤다.
 */
export async function GET() {
  if (!hasSupabaseEnv()) return new NextResponse(null, { status: 404 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = tenantIdFromUser(user);
  if (!user || !tenantId) return new NextResponse(null, { status: 401 });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("logo_url")
    .eq("id", tenantId)
    .maybeSingle();
  const path = tenant?.logo_url;
  if (!path) return new NextResponse(null, { status: 404 });

  // 경로가 자사 폴더 밖을 가리키면 거부한다 (저장 시에도 막지만 이중 방어)
  if (!path.startsWith(`tenant-logos/${tenantId}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: file } = await admin.storage.from(TENANT_LOGO_BUCKET).download(path);
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      "content-type": "image/png",
      // 주소에 갱신 시각이 붙으므로 오래 캐시해도 바뀐 로고가 바로 보인다
      "cache-control": "private, max-age=3600",
    },
  });
}
