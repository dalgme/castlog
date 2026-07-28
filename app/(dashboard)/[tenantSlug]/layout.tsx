import { requireRole } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/sidebar";

/** 테넌트 대시보드 공통 레이아웃 — /{tenant-slug}/... (미들웨어 인증 게이트와 이중 방어) */
export default async function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantSlug: string };
}) {
  await requireRole(["platform_admin", "org_admin", "manager", "staff"]);

  return (
    <div className="flex min-h-screen">
      <Sidebar tenantSlug={params.tenantSlug} />
      <div className="flex min-w-0 flex-1 flex-col bg-secondary/50">
        {children}
      </div>
    </div>
  );
}
