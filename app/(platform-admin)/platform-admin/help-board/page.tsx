import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import { getHelpBoard } from "./actions";
import { HelpBoardPanel } from "./board-panel";

export const metadata = { title: "챗봇 상담게시판" };

/**
 * 챗봇 상담게시판 — 사용자가 챗봇에 말한 불편·오류·이해 실패가 모이는 자리.
 *
 * 제품을 고치는 주체는 넥스트랩이므로 관리모드에 둔다. 각 회사는 자기 회사가
 * 남긴 것만 볼 수 있고(RLS), 여기서는 전체를 본다.
 */
export default async function HelpBoardPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="챗봇 상담게시판" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const rows = await getHelpBoard();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="챗봇 상담게시판" actions={headerActions} />
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <HelpBoardPanel rows={rows} />
      </main>
    </div>
  );
}
