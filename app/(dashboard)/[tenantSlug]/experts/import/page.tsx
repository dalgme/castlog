import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";

import { ExpertImportClient } from "./import-client";
import { DirectImportClient } from "./direct-import-client";

export const metadata = { title: "전문가 일괄 등록" };

/**
 * 전문가 엑셀 일괄 가져오기 (설계문서 7.10, 실행계획 단계 16 + 개정 2026-08-22)
 *
 * 두 경로를 제공한다:
 * 1. 신규 전문가 등록 요청 — 명단 → 등록 요청(expert_invitations) → /j 링크
 *    대량 발급. 전문가 본인이 인증·등록한다 (신원 모델 v1.2 기본 경로).
 * 2. 보유자료로 전문가 가입/등록 — 회사가 보유한 상세 명단(10항목)으로
 *    experts를 직접 생성 + 자사 관계. 본인은 로그인 시 계정을 이어받는다.
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
          <>
            <ExpertImportClient tenantSlug={params.tenantSlug} />
            <DirectImportClient tenantSlug={params.tenantSlug} />
          </>
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
