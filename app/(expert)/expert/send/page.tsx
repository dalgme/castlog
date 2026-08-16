import { requireUser } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PortalHeader } from "@/components/expert/portal-header";
import { PageIntro } from "@/components/expert/ui";
import { EmptyState } from "@/components/layout/empty-state";

import { getSendContext } from "./actions";
import { SendForm } from "./send-form";

export const metadata = { title: "외부 송신" };

/**
 * 전문가 외부 송신 — 캐스트로그 비가입 기업/기관 담당자에게 서류를 만료 링크로 전달.
 * 첨부가 아니라 서명된 만료 다운로드 링크(§5). 발송 내역·메모·회수·수신확인 지원.
 */
export default async function ExpertSendPage() {
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

  const context = await getSendContext();

  return (
    <div className="min-h-screen bg-muted">
      <PortalHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <PageIntro
          eyebrow="SEND"
          title="외부 송신"
          description="이력서·신분증사본·통장사본을 외부 담당자에게 안전한 만료 다운로드 링크로 보냅니다. 첨부와 달리 만료·회수·열람 확인이 됩니다."
        />
        <SendForm
          standardDocs={context.standardDocs}
          history={context.history}
          senderName={context.senderName}
          senderEmail={context.senderEmail}
        />
      </main>
    </div>
  );
}
