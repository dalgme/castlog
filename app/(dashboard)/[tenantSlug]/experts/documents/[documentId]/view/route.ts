import { NextResponse, type NextRequest } from "next/server";

import { issueDocumentViewUrl } from "@/lib/experts/document-view";

/**
 * 기업 측 전문가 서류 열람 — 만료 서명 URL로 리다이렉트.
 * 권한 판정은 RLS(활성 연결 + 열람 허용 grants), 열람은 audit_logs 기록.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string; documentId: string } }
) {
  const result = await issueDocumentViewUrl(params.documentId);

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/experts`, request.url)
    );
  }

  return NextResponse.redirect(result.url);
}
