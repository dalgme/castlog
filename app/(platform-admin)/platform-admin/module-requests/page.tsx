import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import { listModuleRequests } from "./actions";
import { ModuleRequestList } from "./request-list";

export const metadata = { title: "모듈 추가 요청" };

/**
 * 기업이 올린 모듈 추가 요청 처리.
 * 모듈 조합은 계약(플랜) 정보라 기업이 직접 켤 수 없고 여기서만 반영된다.
 */
export default async function ModuleRequestsPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="모듈 추가 요청" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const requests = await listModuleRequests();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="모듈 추가 요청" actions={headerActions} />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        {requests.length === 0 ? (
          <EmptyState
            title="요청이 없습니다"
            description="기업 설정 화면에서 올린 모듈 추가 요청이 여기에 표시됩니다."
          />
        ) : (
          <ModuleRequestList requests={requests} />
        )}
      </main>
    </div>
  );
}
