import { hasSupabaseEnv } from "@/lib/supabase/env";
import { loadProjectQuotes } from "@/lib/quotes/load";
import { EmptyState } from "@/components/layout/empty-state";

import { QuotePanel, type QuoteView } from "./quote-panel";

/**
 * 견적·정산 탭 로더 (서버). 열람은 RLS(프로젝트 열람 범위), 편집 자격은
 * page에서 판정해 canEdit로 받는다 (프로젝트 팀 + 전사 열람 권한자).
 */
export async function QuoteTab({
  tenantSlug,
  projectId,
  canEdit,
}: {
  tenantSlug: string;
  projectId: string;
  canEdit: boolean;
}) {
  if (!hasSupabaseEnv()) {
    return <EmptyState title="서버 설정 대기 중" description="Supabase 환경변수가 설정되면 표시됩니다." />;
  }
  const { quotes, missingTable } = await loadProjectQuotes(projectId);
  if (missingTable) {
    return (
      <EmptyState
        title="견적·정산 기능이 아직 준비되지 않았습니다"
        description="마이그레이션(20260909000001) 적용 후 사용할 수 있습니다 — 캐스트로그에 알려 주세요."
      />
    );
  }
  return (
    <QuotePanel
      tenantSlug={tenantSlug}
      projectId={projectId}
      canEdit={canEdit}
      quotes={quotes as QuoteView[]}
    />
  );
}
