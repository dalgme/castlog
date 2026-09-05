import { NextResponse, type NextRequest } from "next/server";

import { issueDocumentViewUrl } from "@/lib/experts/document-view";

/**
 * 전문가 본인 서류 열람 — 만료 서명 URL로 리다이렉트.
 * 권한 판정은 RLS(본인 소유), 열람은 audit_logs 기록 (lib/experts/document-view).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const download = request.nextUrl.searchParams.get("download") === "1";
  const result = await issueDocumentViewUrl(params.documentId, { download });

  if (!result.ok) {
    return NextResponse.redirect(new URL("/expert/documents", request.url));
  }

  return NextResponse.redirect(result.url);
}
