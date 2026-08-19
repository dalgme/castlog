import { TenantShell } from "@/components/layout/tenant-shell";

/** 테넌트 대시보드 공통 레이아웃 — /{tenant-slug}/... (미들웨어 인증 게이트와 이중 방어) */
export default function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantSlug: string };
}) {
  return <TenantShell tenantSlug={params.tenantSlug}>{children}</TenantShell>;
}
