import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { createClient } from "@/lib/supabase/server";
import { issueDocumentViewUrl } from "@/lib/experts/document-view";
import { SENSITIVE_DOCUMENT_TYPES } from "@/lib/experts/documents";

/**
 * 기업 측 전문가 서류 열람 — 만료 서명 URL로 리다이렉트.
 * 역할 게이트는 서류 목록·미리보기와 같이 전 직원(staff 포함) — 목록의 '원본'이 대시보드로
 * 튕기던 결함 수정 (렛츠 보고 2026-11-11). 민감서류(통장사본·신분증·통합)는 종전대로 팀장 이상만:
 * 아닌 사람은 미리보기 화면으로 보내 이유를 보여 준다.
 * 세부 열람 범위 판정은 RLS(활성 연결 + 열람 허용 grants · 이력서는 자사 임직원), 열람은 audit_logs 기록.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantSlug: string; documentId: string } }
) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  if (roleFromUser(user) === "staff") {
    const { data: doc } = await createClient()
      .from("expert_documents")
      .select("document_type")
      .eq("id", params.documentId)
      .maybeSingle();
    if (doc && SENSITIVE_DOCUMENT_TYPES.includes(doc.document_type)) {
      return NextResponse.redirect(
        new URL(`/${params.tenantSlug}/experts/documents/${params.documentId}/preview`, request.url)
      );
    }
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const result = await issueDocumentViewUrl(params.documentId, { download });

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/${params.tenantSlug}/experts`, request.url)
    );
  }

  return NextResponse.redirect(result.url);
}
