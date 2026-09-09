import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { loadProjectQuotes } from "@/lib/quotes/load";
import { loadCostSheets } from "@/lib/quotes/cost-load";
import { EmptyState } from "@/components/layout/empty-state";

import { QuoteWorkbench } from "./quote-workbench";
import type { QuoteView } from "./quote-panel";

/**
 * 견적·정산 탭 로더 (서버) — 견적서·내부실견적서·정산서를 한 번에 읽는다.
 * 열람은 RLS(견적은 프로젝트 열람 범위, 원가문서는 프로젝트 팀), 편집 자격은
 * page에서 판정해 canEdit로 받는다.
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
  const [{ quotes, missingTable }, { sheets }] = await Promise.all([
    loadProjectQuotes(projectId),
    loadCostSheets(projectId),
  ]);
  if (missingTable) {
    return (
      <EmptyState
        title="견적·정산 기능이 아직 준비되지 않았습니다"
        description="마이그레이션(20260909000001) 적용 후 사용할 수 있습니다 — 캐스트로그에 알려 주세요."
      />
    );
  }

  // 수정 허용 지정 대상 — 자사 재직자 (RLS 범위)
  const supabase = createClient();
  const { data: users } = await supabase
    .from("users")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(300);

  return (
    <QuoteWorkbench
      tenantSlug={tenantSlug}
      projectId={projectId}
      canEdit={canEdit}
      quotes={quotes as QuoteView[]}
      costSheets={sheets}
      users={users ?? []}
    />
  );
}
