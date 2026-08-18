import { requireRole } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

import { getInquiries } from "./actions";
import { InquiryList } from "./inquiry-list";

export const metadata = { title: "도입 문의 · 체험 신청" };

/**
 * 랜딩(/contact)에서 접수된 무료 체험 신청·도입 상담 문의 처리 화면.
 * 신청만으로 테넌트가 자동 생성되지는 않는다 — 여기서 확인 후 수동 생성한다.
 */
export default async function PlatformInquiriesPage() {
  await requireRole(["platform_admin"]);

  const headerActions = (
    <Button asChild variant="outline" size="sm">
      <a href="/platform-admin">← 캐스트로그 관리모드</a>
    </Button>
  );

  if (!hasSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-secondary/50">
        <PageHeader title="도입 문의 · 체험 신청" actions={headerActions} />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const inquiries = await getInquiries();

  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="도입 문의 · 체험 신청" actions={headerActions} />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        {inquiries.length === 0 ? (
          <EmptyState
            title="접수된 신청이 없습니다"
            description="랜딩페이지의 ‘무료 체험 시작’·‘도입 상담’ 폼으로 들어온 신청이 여기에 표시됩니다."
          />
        ) : (
          <InquiryList inquiries={inquiries} />
        )}
      </main>
    </div>
  );
}
