import { MessageSquare } from "lucide-react";

import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { loadNotesSnapshot } from "@/lib/notes/server";
import { isNoteView, kstDateKey, type NoteView } from "@/lib/notes/types";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import { NotesWorkspace } from "./notes-workspace";

export const metadata = { title: "쪽지" };
export const dynamic = "force-dynamic";

/**
 * 임직원 쪽지 (기획 지시 2026-11-07) — 공통 기반. 네이버웍스 채팅과 비슷한 두 칸 화면:
 * 왼쪽은 날짜·시간순 / 사람별 / 프로젝트별 목록, 오른쪽은 대화(말풍선)와 바로 답장.
 * 데이터는 서버에서 한 번에 내려주고(RLS: 당사자만), 화면은 20초마다 새로 고친다.
 */
export default async function NotesPage({
  params,
  searchParams,
}: {
  params: { tenantSlug: string };
  searchParams: { view?: string; with?: string; topic?: string };
}) {
  const user = await requireRole(["platform_admin", "org_admin", "manager", "staff"]);

  if (!hasSupabaseEnv() || !user) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="쪽지" />
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <EmptyState title="서버 설정 대기 중" />
        </main>
      </div>
    );
  }

  const snapshot = await loadNotesSnapshot(user.id);
  const view: NoteView = isNoteView(searchParams.view) ? searchParams.view : "time";

  return (
    <div className="flex min-h-screen flex-col bg-secondary/50">
      <PageHeader
        title="쪽지"
        actions={
          snapshot.ready ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/${params.tenantSlug}/notes/export`}>엑셀</a>
            </Button>
          ) : undefined
        }
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-3 sm:p-6">
        {snapshot.ready ? (
          <NotesWorkspace
            tenantSlug={params.tenantSlug}
            myUserId={user.id}
            view={view}
            withUserId={searchParams.with ?? null}
            topicKey={searchParams.topic ?? null}
            notes={snapshot.notes}
            users={snapshot.users}
            projects={snapshot.projects}
            todayKey={kstDateKey(new Date().toISOString())}
          />
        ) : (
          <EmptyState
            icon={<MessageSquare className="h-8 w-8" />}
            title="쪽지 기능 준비 중"
            description="데이터베이스 마이그레이션(0011 staff_notes)이 적용되면 이 자리에 쪽지함이 열립니다. 관리자에게 적용을 요청해 주세요."
          />
        )}
      </main>
    </div>
  );
}
