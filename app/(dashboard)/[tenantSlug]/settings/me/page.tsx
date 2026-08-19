import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, gradeLabel } from "@/lib/auth/grades";
import {
  getAdminScopes,
  ADMIN_SCOPE_LABELS,
  ADMIN_SCOPES,
  canManagePayments,
} from "@/lib/auth/admin-scopes";
import { getTenantModules } from "@/lib/modules/server";
import { MODULE_KEYS, MODULE_LABELS } from "@/lib/modules/modules";
import { createClient } from "@/lib/supabase/server";
import { tenantLogoSrc } from "@/lib/branding/tenant-logo";
import { canEnterPlatformMode } from "@/lib/auth/platform-mode";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsTabs } from "@/components/layout/settings-tabs";

import { buildStaffJoinLink, buildTenantHomeLink } from "@/lib/routing/links";

import { ProfileForm } from "./profile-form";
import { TenantLogoForm } from "./logo-form";
import { CompanyAddressCard } from "./company-address-card";

export const metadata = { title: "내 설정" };

/**
 * 내 설정 — **모든 등급이 가진 '설정'**.
 *
 * 지금까지 '설정'은 대표·위임자 전용이라, 대리 이하 직원에게는 설정이라는 개념이
 * 아예 없었다. 자기 연락처를 고치는 것도 관리자에게 부탁해야 했다. 등급과 무관하게
 * 누구나 가지는 설정을 여기에 모은다: 내 정보 · 비밀번호 · 내 권한 확인.
 *
 * 권한 요약을 함께 보여 주는 이유: "이 메뉴가 왜 안 보이지"의 답이 여기 있어야
 * 한다. 안 보이는 이유를 모르면 사용자는 시스템이 고장 났다고 생각한다.
 */
export default async function MySettingsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const user = await requireRole([
    "platform_admin",
    "org_admin",
    "manager",
    "staff",
  ]);

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="내 설정" />
        <main className="p-5">
          <EmptyState
            title="서버 설정 대기 중"
            description="Supabase 환경변수가 설정되면 표시됩니다."
          />
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const [{ data: me }, scopes, modules, payments] = await Promise.all([
    supabase
      .from("users")
      .select("name, email, phone, department, grade")
      .eq("id", user?.id ?? "")
      .maybeSingle(),
    getAdminScopes(),
    getTenantModules(),
    canManagePayments(),
  ]);
  const logoSrc = await tenantLogoSrc();
  // 넥스트랩 운영자에게만 — 전환이 안 될 때 원인을 볼 수 있는 자리
  const canSwitchPlatform = canEnterPlatformMode(user);

  const role = roleFromUser(user);
  const grade = gradeFromUser(user);
  const isCeo = role === "org_admin" || role === "platform_admin";
  const grantedScopes = ADMIN_SCOPES.filter((s) => scopes[s]);
  const canManageSending = isCeo || scopes.sending;
  const canRequestModules = isCeo || scopes.settings;

  // base URL 미설정(프리뷰 배포)에서는 주소 카드를 숨긴다 — 틀린 주소를 보여
  // 주느니 안 보여 주는 편이 낫다. 인쇄·공지에 그대로 옮겨 적히는 값이다.
  let addresses: { home: string; join: string } | null = null;
  try {
    addresses = {
      home: buildTenantHomeLink(params.tenantSlug),
      join: buildStaffJoinLink(params.tenantSlug),
    };
  } catch {
    addresses = null;
  }

  return (
    <div>
      <PageHeader title="설정" />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showSms={canManageSending}
        showOrg={canRequestModules}
        showRules={modules.approvals && canRequestModules}
      />
      {/* 좁은 칸에 카드를 세로로 쌓으면 넓은 화면에서 오른쪽이 통째로 빈다.
          설정은 훑어보는 화면이므로 한눈에 들어오는 편이 낫다 */}
      <main className="grid items-start gap-4 p-4 sm:p-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">내 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              name={me?.name ?? ""}
              phone={me?.phone ?? null}
            />
            <dl className="mt-5 space-y-1.5 border-t pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">이메일 (로그인 계정)</dt>
                <dd className="truncate font-medium">{me?.email ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">직급</dt>
                <dd className="font-medium">{gradeLabel(grade)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">부서</dt>
                <dd className="font-medium">{me?.department ?? "-"}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              이메일·직급·부서는 인사 권한자(대표 또는 ‘직원·직급 관리’ 위임자)가
              변경합니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">비밀번호</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              주기적으로 변경하세요. 다른 서비스와 같은 비밀번호를 쓰지 않는 것이
              가장 중요합니다.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/account/password">비밀번호 변경</Link>
            </Button>
          </CardContent>
        </Card>

        {canSwitchPlatform && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">캐스트로그 관리자 모드</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                운영사 계정입니다. 상단 바의 ‘관리자 모드’ 버튼으로 전환하며,
                전환이 되지 않으면 아래에서 원인을 확인할 수 있습니다.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/account/admin-mode">관리자 모드 진단</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">회사 로고</CardTitle>
          </CardHeader>
          <CardContent>
            <TenantLogoForm currentSrc={logoSrc} canEdit={canRequestModules} />
          </CardContent>
        </Card>

        {addresses && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">우리 회사 주소</CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyAddressCard
                homeUrl={addresses.home}
                joinUrl={addresses.join}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">내 권한</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">프로젝트 열람 범위</span>
              <Badge variant={canViewAllProjects(grade) ? "default" : "secondary"}>
                {canViewAllProjects(grade)
                  ? "전사 프로젝트"
                  : "배정된 프로젝트만"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">지급·비용 열람</span>
              <Badge variant={payments ? "default" : "secondary"}>
                {payments ? "가능" : "권한 없음"}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">위임받은 관리 권한</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {isCeo ? (
                  <Badge>대표 — 전체</Badge>
                ) : grantedScopes.length === 0 ? (
                  <span className="text-muted-foreground">없음</span>
                ) : (
                  grantedScopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {ADMIN_SCOPE_LABELS[s]}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">우리 회사 사용 기능</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MODULE_KEYS.filter((k) => modules[k]).map((k) => (
                  <Badge key={k} variant="secondary">
                    {MODULE_LABELS[k]}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              메뉴가 보이지 않는다면 위 권한·사용 기능 때문입니다. 권한 조정은
              대표에게 요청하세요.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
