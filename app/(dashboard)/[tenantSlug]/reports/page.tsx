import Link from "next/link";
import { Hammer } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "보고서" };

/**
 * 보고서 — 준비 중.
 *
 * 사이드바가 이 경로를 가리키는데 화면이 없어 404가 났다. 메뉴에서 지우는 대신
 * 상태를 정직하게 알린다: 무엇을 만들 예정이고 지금은 무엇으로 대신할 수 있는지.
 * 동작하지 않는 버튼을 완료로 보이게 두지 않는다 (CLAUDE.md §14-7).
 */
export default async function ReportsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);
  await requireModule("operations");

  return (
    <div>
      <PageHeader title="보고서" />
      <main className="p-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary">
                <Hammer className="h-5 w-5 text-muted-foreground" aria-hidden />
              </span>
              <div>
                <p className="text-base font-bold text-brand-navy">준비 중입니다</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  프로젝트 결과보고서 자동 생성(사업 개요·세션 실적·전문가 활동·
                  집행 내역 취합)은 아직 열리지 않았습니다. 준비가 끝나면 이 화면에서
                  바로 만들 수 있게 됩니다.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  그때까지는 아래 화면에서 필요한 자료를 엑셀로 내려받아 쓰실 수
                  있습니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${params.tenantSlug}/projects`}>프로젝트 목록</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${params.tenantSlug}/experts/engagements`}>
                      섭외 현황
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${params.tenantSlug}/executive`}>업무배정 현황</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
