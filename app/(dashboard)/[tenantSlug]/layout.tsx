import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { Sidebar } from "@/components/layout/sidebar";
import { AlertBanner } from "@/components/layout/alert-banner";

/** 테넌트 대시보드 공통 레이아웃 — /{tenant-slug}/... (미들웨어 인증 게이트와 이중 방어) */
export default async function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantSlug: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  const [modules, adminScopes] = await Promise.all([
    getTenantModules(),
    getAdminScopes(),
  ]);
  const role = roleFromUser(user);
  // 대표 외에도 관리 스코프를 위임받은 직원에게 '기업 관리' 메뉴를 연다
  const isOrgAdmin =
    role === "org_admin" ||
    role === "platform_admin" ||
    Object.values(adminScopes).some(Boolean);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tenantSlug={params.tenantSlug}
        modules={modules}
        isOrgAdmin={isOrgAdmin}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-secondary/50">
        <AlertBanner />
        {children}
      </div>
    </div>
  );
}
