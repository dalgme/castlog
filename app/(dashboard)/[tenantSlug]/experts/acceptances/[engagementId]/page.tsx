import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { canExecTenant } from "@/lib/auth/exec-policy";
import { isExpertsLite, requireModule } from "@/lib/modules/server";
import { getAcceptanceView } from "@/lib/integrations/acceptance-view";
import { ENGAGEMENT_STATUS_LABELS } from "@/lib/integrations/engagements";
import { createClient } from "@/lib/supabase/server";
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
  const expertsLite = await isExpertsLite();

  const view = await getAcceptanceView(params.engagementId);
  if (!view) {
    // 섭외 건 자체가 없거나 볼 수 없는 경우만 404다. 건은 있는데 수락서가 아직
    // 없는 경우를 404로 떨어뜨리면 사용자에게는 그냥 '에러'로 보인다 — 무엇이
    // 없는지, 언제 생기는지를 말해 준다.
    const supabase = createClient();
    const { data: engagement } = await supabase
      .from("expert_engagements")
      .select("id, status, project_id, experts (name)")
      .eq("id", params.engagementId)
      .maybeSingle();
    if (!engagement) notFound();

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
        <main className="mx-auto max-w-2xl space-y-4 p-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">아직 수락서가 없습니다</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                수락서는 전문가가 <strong>섭외를 수락한 시점</strong>에 자동으로
                만들어집니다. 현재 이 건은{" "}
                <strong>
                  {ENGAGEMENT_STATUS_LABELS[engagement.status] ?? engagement.status}
                </strong>{" "}
                상태입니다.
              </p>
              {engagement.status === "accepted" && (
                <p>
                  수락 처리는 되었으나 수락서 생성이 아직 끝나지 않았습니다. 잠시 뒤
                  다시 열어 보시고, 계속 같은 화면이면 담당자에게 알려 주세요.
                </p>
              )}
              {engagement.project_id && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/${params.tenantSlug}/projects/${engagement.project_id}?tab=experts`}
                  >
                    프로젝트 섭외 현황으로
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // 수락서 발송·재발송은 레벨 4(대리)부터 — 서버 게이트(acceptanceSend)와 같은 기준
  const canManage = await canExecTenant("acceptanceSend", user);

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
              <CardTitle className="text-sm">
                {expertsLite ? "수락서 확인" : "수락서 보완 · 송부"}
              </CardTitle>
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
                expertsLite={expertsLite}
                signedAt={view.acceptance.signed_at}
              />
            </CardContent>
          </Card>
        )}
        <AcceptanceLetter {...view} />
      </main>
    </div>
  );
}
