import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata = { title: "전문가 포털" };

/**
 * 전문가 포털 — 테넌트에 종속되지 않는 전역 경로 /expert (설계문서 5.2).
 * 전문가는 여러 기업에 연결될 수 있으므로 화면 안에서 기업별로 구분해 보여준다.
 * 모바일 완전 대응 대상 (설계문서 8.1 최우선).
 */
export default function ExpertPortalPage() {
  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="전문가 포털" />
      <main className="p-5">
        <EmptyState
          title="전문가 포털 준비 중"
          description="전 기업 통합 이력, 서류함, 지급 현황이 여기에 연결됩니다 (단계 6~7)."
        />
      </main>
    </div>
  );
}
