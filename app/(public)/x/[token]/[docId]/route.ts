import { NextResponse, type NextRequest } from "next/server";

import { issueExternalDownloadUrl } from "@/lib/experts/external-send";

/**
 * 외부 송신 다운로드 — 토큰+문서 검증 후 만료 서명 URL로 리다이렉트.
 * 유효하지 않으면 다운로드 안내 페이지로 돌려보낸다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; docId: string } }
) {
  const url = await issueExternalDownloadUrl(params.token, params.docId);
  if (!url) {
    return NextResponse.redirect(new URL(`/x/${params.token}`, request.url));
  }
  return NextResponse.redirect(url);
}
