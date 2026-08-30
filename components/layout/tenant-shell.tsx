import { Suspense } from "react";

import { requireRole } from "@/lib/auth/session";
import { roleFromUser, practiceFromUser, tenantIdFromUser } from "@/lib/auth/tenant";
import { getTenantModules, isExpertsLite } from "@/lib/modules/server";
import { getPendingModuleOnboarding } from "@/lib/modules/onboarding";
import { MODULE_ONBOARDING_HINTS } from "@/lib/modules/modules";
import { canManagePayments, getAdminScopes } from "@/lib/auth/admin-scopes";
import { getMyTurnApprovals } from "@/lib/approvals/my-turn";
import { getSetupStatus } from "@/lib/onboarding/setup-checklist";
import { createClient } from "@/lib/supabase/server";
import { tenantLogoSrc } from "@/lib/branding/tenant-logo";
import { isMonitorActive } from "@/lib/monitoring/flags";
import { shouldShowWelcomeTour } from "@/lib/onboarding/welcome-tour";
import { WelcomeTour } from "@/components/onboarding/welcome-tour";
import { SetupReturnBar } from "@/components/onboarding/setup-return-bar";
import { HelpChat } from "@/components/support/help-chat";
import { hasSupabaseEnv } from "@/lib/supabase/env";

import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { AlertBanner } from "./alert-banner";
import { PracticeBar } from "./practice-bar";
import { ModuleOnboarding } from "./module-onboarding";
import { SetupBanner } from "./setup-banner";

/**
 * 테넌트 공통 셸 — 사이드바 + 상단 바 + 각종 안내 띠.
 *
 * 대시보드와 기업관리가 서로 다른 라우트 그룹에 있어 기업관리만 셸 없이 단독
 * 화면으로 떴다. 메뉴가 사라지면 사용자는 자기가 어디로 튕겨 나왔다고 느낀다.
 * 셸을 한 곳으로 모아 두 그룹이 같은 것을 쓰게 한다.
 */
export async function TenantShell({
  tenantSlug,
  children,
}: {
  tenantSlug: string;
  children: React.ReactNode;
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);
  const [modules, adminScopes, pendingOnboarding, payments, expertsLite] =
    await Promise.all([
      getTenantModules(),
      getAdminScopes(),
      getPendingModuleOnboarding(),
      canManagePayments(),
      isExpertsLite(),
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

  const tenantId = tenantIdFromUser(user);
  // 내 결재 차례 배지 — 결재권자가 도착을 모르면 승인 게이트에 걸린 팀이 멈춘다 (검수 A3)
  const approvalsBadge =
    modules.approvals && user ? (await getMyTurnApprovals(user.id)).length : 0;

  let tenantName: string | null = null;
  let testSupport = false;
  if (hasSupabaseEnv() && tenantId) {
    const supabase = createClient();
    const { data } = await supabase
      .from("tenants")
      .select("name, feature_flags")
      .maybeSingle();
    tenantName = data?.name ?? null;
    // 실시간 모니터링 창이 열려 있으면 챗봇이 테스트 지원 모드로 표시된다
    testSupport = isMonitorActive(data?.feature_flags);
  }
  // 회사 로고 — 사이드바와 챗봇이 함께 쓴다
  const logoSrc = await tenantLogoSrc();
  // 처음 들어온 사람에게만 뜨는 안내. 연습모드에서는 띄우지 않는다 —
  // 연습을 하러 들어온 사람에게 시작 안내를 다시 꺼낼 이유가 없다
  const showTour = !practice && (await shouldShowWelcomeTour());

  // 최초 설정 안내 — 설정을 실제로 할 수 있는 사람에게만.
  // 연습모드에서는 띄우지 않는다(연습 환경의 설정 상태가 아니다).
  const setup =
    !practice && isOrgAdmin && tenantId
      ? await getSetupStatus(tenantId, tenantSlug, modules)
      : null;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tenantSlug={tenantSlug}
        modules={modules}
        isOrgAdmin={isOrgAdmin}
        canManagePayments={payments}
        expertsLite={expertsLite}
        approvalsBadge={approvalsBadge}
        tenantName={tenantName}
        logoSrc={logoSrc}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-secondary/50">
        <TopBar
          tenantSlug={tenantSlug}
          tenantName={tenantName}
          practice={practice}
          canPractice={canPractice}
        />
        {canPractice && <PracticeBar practice={practice} />}
        {/* 최초 설정에서 출발했다면 돌아올 길을 항상 띄운다 — 설정 화면마다
            붙이면 다음에 만든 화면에서 또 길이 끊긴다 */}
        <Suspense fallback={null}>
          <SetupReturnBar tenantSlug={tenantSlug} />
        </Suspense>
        {setup && (
          <SetupBanner
            tenantSlug={tenantSlug}
            requiredRemaining={setup.requiredRemaining}
            recommendedRemaining={setup.recommendedRemaining}
          />
        )}
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
        {/* 도우미는 화면 오른쪽 아래에 떠 있는다 — 본문 흐름 밖이라 셸 최상위에
            둔다. 상단 바 안에 두면 사이드바 폭에 따라 위치가 흔들린다 */}
        <HelpChat
          tenantName={tenantName}
          logoSrc={logoSrc}
          testSupport={testSupport}
        />
        {showTour && (
          <WelcomeTour tenantName={tenantName} logoSrc={logoSrc} />
        )}
        {children}
      </div>
    </div>
  );
}
