import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getAcceptanceView } from "@/lib/integrations/acceptance-view";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { AcceptanceLetter } from "@/components/integrations/acceptance-letter";

import { AcceptanceSignButton } from "./sign-button";
import { getPortalRewrapContext } from "./rewrap-actions";
import { PortalRewrapSection } from "./rewrap-section";

export const metadata = { title: "섭외 수락서" };

/** 전문가 포털 — 자신이 수락한 섭외의 수락서 열람 (전 기업 통합 이력). */
export default async function ExpertAcceptancePage({
  params,
}: {
  params: { engagementId: string };
}) {
  await requireUser("/expert/login");

  const view = await getAcceptanceView(params.engagementId);
  if (!view) notFound();

  // 지급용 주민번호 키 전달(선택) — 공개 링크에서 놓친 전문가의 정식 경로
  const rewrap = await getPortalRewrapContext(params.engagementId);

  return (
    <div className="min-h-screen bg-muted">
      <PageHeader
        title="섭외 수락서"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/expert/engagements">돌아가기</Link>
          </Button>
        }
      />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-5">
        <AcceptanceSignButton
          acceptanceId={view.acceptance.id}
          status={view.acceptance.status}
          signedAt={view.acceptance.signed_at}
          hasSignature={view.acceptance.has_signature}
          signaturePreviewUrl={view.signatureUrl}
        />
        <PortalRewrapSection engagementId={params.engagementId} ctx={rewrap} />
        <AcceptanceLetter {...view} />
      </main>
    </div>
  );
}
