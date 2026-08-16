import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { getSupportTickets } from "./actions";
import { SupportPanel } from "./support-panel";

export const metadata = { title: "문의/지원" };

/**
 * 전문가 문의/지원 티켓 (#7) — 로그인 전문가가 플랫폼(넥스트랩)에 문의하고
 * 스레드로 답변받는다. 도입 문의(platform_inquiries)와 구분된 지원 채널.
 */
export default async function ExpertSupportPage() {
  const user = await requireUser("/expert/login");

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <PortalHeader />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const tickets = await getSupportTickets();

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="SUPPORT"
          title="문의 · 지원"
          description="이용 중 궁금한 점이나 도움이 필요한 사항을 남기면 운영팀이 답변해 드립니다."
        />
        <SupportPanel tickets={tickets} />
      </main>
    </div>
  );
}
