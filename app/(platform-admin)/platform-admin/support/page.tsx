import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import { getAllTickets } from "./actions";
import { AdminSupportPanel } from "./admin-support-panel";

export const metadata = { title: "전문가 문의 · 지원" };

export default async function PlatformSupportPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 플랫폼 관리</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="전문가 문의 · 지원" actions={headerActions} />
        <main className="p-5">
          <EmptyState title="서버 설정 대기 중" description="Supabase 환경변수가 설정되면 표시됩니다." />
        </main>
      </div>
    );
  }

  const tickets = await getAllTickets();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="전문가 문의 · 지원" actions={headerActions} />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <AdminSupportPanel tickets={tickets} />
      </main>
    </div>
  );
}
