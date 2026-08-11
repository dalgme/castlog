import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { getAcceptanceView } from "@/lib/integrations/acceptance-view";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { AcceptanceLetter } from "@/components/integrations/acceptance-letter";

export const metadata = { title: "섭외 수락서" };

/** 기업 화면 — 전문가가 자동 서명한 섭외수락서 열람 (experts 모듈). */
export default async function TenantAcceptancePage({
  params,
}: {
  params: { tenantSlug: string; engagementId: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("experts");

  const view = await getAcceptanceView(params.engagementId);
  if (!view) notFound();

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
      <main className="mx-auto max-w-2xl p-5">
        <AcceptanceLetter {...view} />
      </main>
    </div>
  );
}
