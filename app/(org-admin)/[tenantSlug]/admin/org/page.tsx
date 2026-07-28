import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata = { title: "기업 관리" };

/** 기업총괄관리자 셸 — 결재라인·전결규정·직원 계정 관리(단계 8·10) */
export default async function OrgAdminPage() {
  await requireRole(["org_admin", "platform_admin"]);
  return (
    <div className="min-h-screen bg-secondary/50">
      <PageHeader title="기업 관리" />
      <main className="p-5">
        <EmptyState
          title="기업 관리 화면 준비 중"
          description="직원 계정·권한·직급 관리(단계 8), 결재라인·전결규정(단계 10)이 여기에 연결됩니다."
        />
      </main>
    </div>
  );
}
