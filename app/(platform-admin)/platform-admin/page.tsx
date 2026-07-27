import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata = { title: "플랫폼 관리" };

/**
 * 플랫폼관리자 전역 경로 (테넌트 슬러그 없음).
 * 테넌트 수동 생성(단계 8)·기능 플래그·사용량 현황이 연결된다.
 * 주의: 플랫폼관리자도 전문가 세무정보 조회 권한은 없다 (설계문서 4.4).
 */
export default function PlatformAdminPage() {
  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="플랫폼 관리" />
      <main className="p-5">
        <EmptyState
          title="플랫폼 관리 화면 준비 중"
          description="테넌트 수동 생성, 기능 플래그, 사용량 미터링 현황이 여기에 연결됩니다."
        />
      </main>
    </div>
  );
}
