import { Sidebar } from "@/components/layout/sidebar";

/** 테넌트 대시보드 공통 레이아웃 — /{tenant-slug}/... */
export default function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantSlug: string };
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar tenantSlug={params.tenantSlug} />
      <div className="flex min-w-0 flex-1 flex-col bg-secondary/50">
        {children}
      </div>
    </div>
  );
}
