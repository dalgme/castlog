import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { getAcceptanceView } from "@/lib/integrations/acceptance-view";
import { renderAcceptancePdf } from "@/lib/pdf/acceptance-pdf";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 수락서 PDF 다운로드 (기획 변경 2026-08-30 — 19번).
 *
 * 전문가가 승인(전자서명 또는 수동 확인)을 마친 수락서만 파일로 나간다 —
 * 서명 전 문서가 파일로 유통되면 '확정된 조건'처럼 오독된다.
 * 열람 권한은 getAcceptanceView(RLS)에 위임하고, 다운로드는 별도 감사 기록.
 */
export async function GET(
  _request: Request,
  { params }: { params: { tenantSlug: string; engagementId: string } }
) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  await requireModule("experts");

  const view = await getAcceptanceView(params.engagementId);
  if (!view) {
    return NextResponse.json(
      { error: "수락서를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const status = view.acceptance.status;
  if (status !== "signed" && status !== "confirmed") {
    return NextResponse.json(
      {
        error:
          "전문가가 승인(서명)을 마친 수락서만 PDF로 내려받을 수 있습니다. 현재 상태에서는 화면 열람만 가능합니다.",
      },
      { status: 409 }
    );
  }

  const pdf = await renderAcceptancePdf(view);

  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    tenant_id: tenantIdFromUser(user),
    actor_auth_user_id: user.id,
    actor_role: roleFromUser(user),
    action: "engagement_acceptance.pdf",
    resource_type: "engagement_acceptance",
    resource_id: view.acceptance.id,
  });

  const filename = `수락서_${view.acceptance.letter_no}.pdf`;
  const encoded = encodeURIComponent(filename);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="acceptance_${view.acceptance.letter_no}.pdf"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
