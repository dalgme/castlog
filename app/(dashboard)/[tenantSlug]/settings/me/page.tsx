import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { gradeFromUser, roleFromUser } from "@/lib/auth/tenant";
import { canViewAllProjects, gradeLabel, isUserGrade } from "@/lib/auth/grades";
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
import { SessionFieldsPanel } from "./fields-panel";
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
  const [
    { data: me },
    scopes,
    modules,
    payments,
    sessionFieldsResult,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("name, email, phone, department, grade")
      .eq("id", user?.id ?? "")
      .maybeSingle(),
    getAdminScopes(),
    getTenantModules(),
    canManagePayments(),
    // 세션 분야 마스터 (35번) — 테이블 미적용 환경은 빈 목록 폴백
    supabase
      .from("tenant_session_fields")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);
  const sessionFields = sessionFieldsResult.error
    ? []
    : (sessionFieldsResult.data ?? []);
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

  // 프로젝트 보관 탭 — 대표·이사(전사 열람)만 (기획 2026-08-30)
  const archiveGrade = gradeFromUser(user);
  const showArchiveTab = isUserGrade(archiveGrade) && canViewAllProjects(archiveGrade);

  return (
    <div>
      <PageHeader title="설정" />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={isCeo || scopes.staff}
        showSms={canManageSending}
        showOrg={canRequestModules}
        showRules={modules.approvals && (isCeo || scopes.approvals)}
        showArchive={showArchiveTab}
      />
      <main className="space-y-6 p-4 sm:p-5">
        {/* ── 1. 내 계정 ──────────────────────────────────────────────────
            등급과 무관하게 누구나 갖는 것. 가장 위에 온다 */}
        <Section
          title="내 계정"
          hint="내가 바꿀 수 있는 내 정보입니다."
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">내 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileForm name={me?.name ?? ""} phone={me?.phone ?? null} />
              <dl className="mt-5 space-y-1.5 border-t pt-4 text-sm">
                <Row label="이메일 (로그인 계정)" value={me?.email ?? "-"} />
                <Row label="직급" value={gradeLabel(grade)} />
                <Row label="부서" value={me?.department ?? "-"} />
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                이메일·직급·부서는 인사 권한자(대표 또는 ‘임직원 계정·직급’
                위임자)가 변경합니다.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">비밀번호</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                주기적으로 변경하세요. 다른 서비스와 같은 비밀번호를 쓰지 않는
                것이 가장 중요합니다.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/account/password">비밀번호 변경</Link>
              </Button>
            </CardContent>
          </Card>

          {/* 세션 분야 — 누구나 추가, 회사 공용 (기획 2026-08-30 — 35번) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">분야 (세션 분야 — 회사 공용)</CardTitle>
            </CardHeader>
            <CardContent>
              <SessionFieldsPanel
                fields={sessionFields}
                canDeactivate={isCeo || scopes.settings}
              />
            </CardContent>
          </Card>
        </Section>

        {/* ── 2. 내 권한 ──────────────────────────────────────────────────
            "이 메뉴가 왜 안 보이지"의 답이 여기 있어야 한다 */}
        <Section
          title="내 권한"
          hint="메뉴가 보이지 않는 이유는 대부분 여기 있습니다."
        >
          <Card className="lg:col-span-2">
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <div className="space-y-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">프로젝트 열람 범위</span>
                  <Badge
                    variant={canViewAllProjects(grade) ? "default" : "secondary"}
                  >
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
                  <span className="text-muted-foreground">우리 회사 사용 기능</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {MODULE_KEYS.filter((k) => modules[k]).map((k) => (
                      <Badge key={k} variant="secondary">
                        {MODULE_LABELS[k]}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-sm">
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
                <p className="mt-3 text-xs text-muted-foreground">
                  권한 조정은 대표에게 요청하세요. 관리 권한은 기능 단위로
                  위임되며, 위임받은 사람은 다시 위임할 수 없습니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* ── 3. 회사 브랜드·주소 ─────────────────────────────────────────
            전문가와 임직원이 만나는 접점의 얼굴 (CLAUDE.md §16) */}
        {(canRequestModules || addresses) && (
          <Section
            title="회사 브랜드 · 주소"
            hint="전문가와 임직원이 보는 화면에 그대로 쓰입니다."
          >
            {canRequestModules && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">회사 로고</CardTitle>
                </CardHeader>
                <CardContent>
                  <TenantLogoForm currentSrc={logoSrc} canEdit />
                </CardContent>
              </Card>
            )}
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
          </Section>
        )}

        {/* ── 4. 운영사 도구 — 넥스트랩 계정에만 ─────────────────────── */}
        {canSwitchPlatform && (
          <Section title="캐스트로그 운영" hint="넥스트랩 운영자 계정입니다.">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">관리자 모드</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  상단 바의 ‘관리자 모드’ 버튼으로 전환합니다. 전환이 되지 않으면
                  아래에서 원인을 확인할 수 있습니다.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/account/admin-mode">관리자 모드 진단</Link>
                </Button>
              </CardContent>
            </Card>
          </Section>
        )}
      </main>
    </div>
  );
}

/**
 * 설정 묶음.
 *
 * 예전에는 성격이 다른 카드(내 정보·비밀번호·관리자 모드·회사 로고·권한)가
 * 2열 격자에 한꺼번에 쏟아져서, 무엇이 '나에 관한 것'이고 무엇이 '회사에 관한
 * 것'인지 구분되지 않았다. 카드 수를 줄이는 대신 **묶음에 이름을 붙여** 어디를
 * 봐야 하는지 먼저 알 수 있게 한다.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-bold text-brand-navy">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
