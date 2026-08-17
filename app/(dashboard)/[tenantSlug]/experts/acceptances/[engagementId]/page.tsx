import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { requireModule } from "@/lib/modules/server";
import { getAcceptanceView } from "@/lib/integrations/acceptance-view";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptanceLetter } from "@/components/integrations/acceptance-letter";

import { AcceptanceEditor } from "./acceptance-editor";

export const metadata = { title: "섭외 수락서" };

/**
 * 기업 화면 — 섭외수락서 열람 + 보완 편집·송부·확인 (Phase A-3).
 * 편집·송부·확인은 관리자 이상(권한자)만. 조건 스냅샷은 편집하지 않는다.
 */
export default async function TenantAcceptancePage({
  params,
}: {
  params: { tenantSlug: string; engagementId: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  await requireModule("experts");

  const view = await getAcceptanceView(params.engagementId);
  if (!view) notFound();

  const role = roleFromUser(user);
  const canManage = role === "org_admin" || role === "manager";

  return (
    <div>
      <PageHeader
        title="섭외 수락서"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${params.tenantSlug}/experts`}>전문가 목록</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-2xl space-y-5 p-5">
        {canManage && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">수락서 보완 · 송부</CardTitle>
            </CardHeader>
            <CardContent>
              <AcceptanceEditor
                acceptanceId={view.acceptance.id}
                status={view.acceptance.status}
                guideNote={view.acceptance.guide_note ?? ""}
                paymentDueNote={view.acceptance.payment_due_note ?? ""}
                submissionDocs={view.acceptance.submission_docs ?? ""}
                hasMap={Boolean(view.acceptance.map_image_path)}
                attachments={view.attachments.map((a) => ({
                  id: a.id,
                  fileName: a.fileName,
                }))}
              />
            </CardContent>
          </Card>
        )}
        <AcceptanceLetter {...view} />
      </main>
    </div>
  );
}
