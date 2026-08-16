import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getExpertNotifications } from "@/lib/experts/notifications";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { NotificationList } from "./notification-list";

export const metadata = { title: "알림함" };

/**
 * 전문가 통합 알림함 (설계: expert-utility-features.md §6).
 * 섭외 요청·취소, 서류 요청, 외부 발송 열람, (배포 후) 주민번호 조회를 한 곳에서.
 */
export default async function ExpertNotificationsPage() {
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

  const notifications = await getExpertNotifications();

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="INBOX"
          title="알림함"
          description="섭외·서류 요청, 외부 발송 열람, 주민번호 조회 등 나에게 온 알림을 한 곳에서 확인합니다."
        />
        <NotificationList notifications={notifications} />
      </main>
    </div>
  );
}
