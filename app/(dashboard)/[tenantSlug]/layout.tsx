import { requireRole } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { getTenantModules } from "@/lib/modules/server";
import { getPendingModuleOnboarding } from "@/lib/modules/onboarding";
import { MODULE_ONBOARDING_HINTS } from "@/lib/modules/modules";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { practiceFromUser } from "@/lib/auth/tenant";
import { Sidebar } from "@/components/layout/sidebar";
import { AlertBanner } from "@/components/layout/alert-banner";
import { PracticeBar } from "@/components/layout/practice-bar";
import { ModuleOnboarding } from "@/components/layout/module-onboarding";

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
  const [modules, adminScopes, pendingOnboarding] = await Promise.all([
    getTenantModules(),
    getAdminScopes(),
    getPendingModuleOnboarding(),
  ]);
  const role = roleFromUser(user);
  // 연습모드 — 하위 계정(ceo·이사·팀장·대리·주임·사원) 전부에게 열린다.
  // 플랫폼관리자는 테넌트 소속이 아니므로 대상이 아니다.
  const practice = practiceFromUser(user);
  const canPractice = role !== null && role !== "platform_admin";
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
        {canPractice && <PracticeBar practice={practice} />}
        {/* 새로 켜진 모듈 안내 — 확인하면 사용자별로 사라진다 (CLAUDE.md §1-2-8) */}
        {!practice &&
          pendingOnboarding.map((key) => (
            <ModuleOnboarding
              key={key}
              moduleKey={key}
              hints={MODULE_ONBOARDING_HINTS[key]}
            />
          ))}
        <AlertBanner />
        {children}
      </div>
    </div>
  );
}
