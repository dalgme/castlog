import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { CardGridSkeleton } from "@/components/layout/loading-skeleton";

export const metadata = { title: "대시보드" };

/** 직원·관리자 대시보드 셸 — 실제 데이터 연동은 이후 단계에서 진행 */
export default function DashboardPage() {
  return (
    <>
      <PageHeader title="대시보드" />
      <main className="flex flex-col gap-6 p-5">
        <CardGridSkeleton />
        <EmptyState
          title="아직 표시할 데이터가 없습니다"
          description="프로젝트·세션 CRUD(단계 9)와 결재함(단계 10)이 연결되면 현황이 표시됩니다."
        />
      </main>
    </>
  );
}
