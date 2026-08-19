import { TenantShell } from "@/components/layout/tenant-shell";

/**
 * 기업관리 계열도 대시보드와 같은 셸을 쓴다.
 *
 * 이전에는 이 라우트 그룹에 레이아웃이 없어 기업관리·감사로그·보안현황이
 * 사이드바 없는 단독 화면으로 떴다. 메뉴가 통째로 사라지면 사용자는 자기가
 * 어딘가로 튕겨 나왔다고 느낀다.
 */
export default function OrgAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantSlug: string };
}) {
  return <TenantShell tenantSlug={params.tenantSlug}>{children}</TenantShell>;
}
