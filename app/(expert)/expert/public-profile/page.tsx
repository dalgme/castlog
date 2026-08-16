import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { getPublicProfileContext } from "./actions";
import { PublicProfileManager } from "./public-profile-manager";

export const metadata = { title: "공개 프로필" };

/**
 * 공개 프로필/미니 이력서 관리 (#1) + 경력·실적 아카이브(#5).
 * 전문가가 공개 범위를 직접 통제. 민감정보(주민번호·연락처·서류)는 절대 미포함.
 */
export default async function ExpertPublicProfilePage() {
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

  const context = await getPublicProfileContext();

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="PROFILE"
          title="공개 프로필 · QR"
          description="공유 링크와 QR로 소개할 수 있는 미니 이력서입니다. 공개할 항목을 직접 고르며, 주민번호·연락처·서류 같은 민감정보는 절대 포함되지 않습니다."
        />
        <PublicProfileManager context={context} />
      </main>
    </div>
  );
}
