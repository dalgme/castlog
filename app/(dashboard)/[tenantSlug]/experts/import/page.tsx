import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";

import { ExpertImportClient } from "./import-client";

export const metadata = { title: "전문가 일괄 등록" };

/**
 * 전문가 엑셀 일괄 가져오기 (설계문서 7.10, 실행계획 단계 16)
 *
 * 전문가 신원 모델(v1.2)상 기업이 experts 레코드를 직접 만들 수 없으므로,
 * 엑셀 명단 → 등록 요청(expert_invitations) 일괄 생성 → /j 링크 대량 발급.
 * 백오피스 입력 화면 — PC 최적화 (CLAUDE.md 10).
 */
export default async function ExpertImportPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager"]);
  await requireModule("experts");

  return (
    <div>
      <PageHeader title="전문가 일괄 등록" />
      <main className="mx-auto max-w-4xl space-y-5 p-5">
        {hasSupabaseEnv() ? (
          <ExpertImportClient tenantSlug={params.tenantSlug} />
        ) : (
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 일괄 등록을 사용할 수 있습니다."
          />
        )}
      </main>
    </div>
  );
}
