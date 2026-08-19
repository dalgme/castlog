import { requireRole } from "@/lib/auth/session";
import { connectionSummary } from "@/lib/integrations/connection-checks";
import { PageHeader } from "@/components/layout/header";
import { Button } from "@/components/ui/button";

import { ChecksPanel } from "./checks-panel";

export const metadata = { title: "외부 연동 점검" };

/**
 * 외부 연동 점검 — 키를 넣은 뒤 여기서 한 번 눌러 확인한다.
 *
 * 환경변수는 플랫폼 운영사가 관리하는 값이라 관리모드에 둔다.
 */
export default async function IntegrationsPage() {
  await requireRole(["platform_admin"]);

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader
        title="외부 연동 점검"
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/platform-admin">← 캐스트로그 관리모드</a>
          </Button>
        }
      />
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <ChecksPanel summary={connectionSummary()} />
      </main>
    </div>
  );
}
