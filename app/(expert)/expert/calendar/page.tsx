import Link from "next/link";
import { Download } from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { getCalendarEvents } from "./actions";
import { CalendarView } from "./calendar-view";

export const metadata = { title: "활동 캘린더" };

/**
 * 전문가 활동 캘린더 (#2) — 캐스트로그 섭외(수락 파생) + 외부 섭외 일정(직접 입력).
 * 외부 일정은 캘린더에서 구분 표시하고, 공유 설정 시 연결 기업의 가용성 확인에 노출된다.
 */
export default async function ExpertCalendarPage() {
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

  const events = await getCalendarEvents();

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="CALENDAR"
          title="활동 캘린더"
          description="캐스트로그 섭외 일정과 외부에서 직접 잡은 일정을 한 곳에서 관리합니다. 외부 일정은 공유 설정 시 연결 기업이 섭외 전 가용성 확인에만 참고합니다."
          action={
            <Link
              href="/expert/calendar/export"
              className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/10"
            >
              <Download className="h-4 w-4" aria-hidden />
              iCal 내보내기
            </Link>
          }
        />
        <CalendarView events={events} />
      </main>
    </div>
  );
}
