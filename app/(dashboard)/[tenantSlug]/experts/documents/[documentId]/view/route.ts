import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { issueDocumentViewUrl } from "@/lib/experts/document-view";

/**
 * 기업 측 전문가 서류 열람 — 만료 서명 URL로 리다이렉트.
 * 민감서류(통장사본·신분증)이므로 역할·모듈 게이트를 서버에서 강제한다.
 * 세부 열람 범위 판정은 RLS(활성 연결 + 열람 허용 grants), 열람은 audit_logs 기록.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string; documentId: string } }
) {
  await requireRole(["platform_admin", "org_admin", "manager"]);
  await requireModule("experts");

  const download = request.nextUrl.searchParams.get("download") === "1";
  const result = await issueDocumentViewUrl(params.documentId, { download });

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/experts`, request.url)
    );
  }

  return NextResponse.redirect(result.url);
}
