import Link from "next/link";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { getAdminScopes } from "@/lib/auth/admin-scopes";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getTenantModules } from "@/lib/modules/server";

import { SettingsTabs } from "@/components/layout/settings-tabs";

import { SmsConfigForm } from "./sms-config-form";
import { SmsConnectionPanel } from "./sms-connection-panel";

export const metadata = { title: "설정" };

const PROVIDER_LABELS: Record<string, string> = {
  solapi: "솔라피 (Solapi)",
  aligo: "알리고 (Aligo)",
  nhncloud: "NHN Cloud",
};

/**
 * 테넌트 설정 (총괄관리자) — 발송(SMS BYO 공급자) 설정.
 * 인증 OTP는 플랫폼 전역 발송이므로 여기서 설정하지 않는다 (CLAUDE.md 5-2).
 */
export default async function SettingsPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  // 대표·플랫폼관리자 또는 '발송 설정·템플릿' 위임을 받은 직원 (CLAUDE.md 3-1)
  const gateUser = await requireUser();
  let canManageSending = false;
  // 모듈 추가 요청은 '설정' 위임 범위다 — 발송 위임만 받은 직원에게는 숨긴다.
  let canRequestModules = false;
  let canManageStaff = false;
  if (gateUser) {
    const role = roleFromUser(gateUser);
    const scopes = await getAdminScopes();
    const isCeo = role === "org_admin" || role === "platform_admin";
    canManageSending = isCeo || scopes.sending;
    canRequestModules = isCeo || scopes.settings || scopes.modules;
    canManageStaff = isCeo || scopes.staff;
    // 사이드바 '설정'은 이 화면(SMS)으로 온다. 발송 권한이 없는 위임자에게는
    // 빈 화면이 되므로, 그 사람이 실제로 쓸 수 있는 첫 탭으로 보낸다.
    // 아무 권한도 없으면 누구에게나 있는 '내 설정'으로 — 대시보드로 되돌리면
    // '설정을 눌렀는데 아무 일도 안 일어난다'가 된다.
    if (!canManageSending) {
      if (canManageStaff) redirect(`/${params.tenantSlug}/admin/staff`);
      if (canRequestModules) redirect(`/${params.tenantSlug}/admin/org`);
      redirect(`/${params.tenantSlug}/settings/me`);
    }
  }

  if (!hasSupabaseEnv()) {
    return (
      <div>
        <PageHeader title="설정" />
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
  const { data: config } = await supabase
    .from("tenant_sms_configs")
    .select("provider, sender_number, is_active")
    .maybeSingle();

  // 사용 기능(모듈) 현황·추가 요청은 '기업관리' 탭으로 옮겼다 — 발송 설정 옆에
  // 계약 정보가 있을 이유가 없었다. 여기서는 탭 노출 판단에만 쓴다.
  const modules = await getTenantModules();

  return (
    <div>
      <PageHeader title="설정" />
      <SettingsTabs
        tenantSlug={params.tenantSlug}
        showStaff={canManageStaff}
        showSms={canManageSending}
        showOrg={canRequestModules}
        showRules={modules.approvals && canRequestModules}
      />
      {/* 기업관리·전결규정 탭과 같은 폭을 쓴다 — 탭을 옮길 때마다 본문 폭이
          달라지면 같은 화면이 아닌 것처럼 읽힌다 */}
      <main className="grid items-start gap-4 p-4 sm:p-5 lg:grid-cols-2">
        {canManageSending && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">SMS 연결 상태</CardTitle>
          </CardHeader>
          <CardContent>
            <SmsConnectionPanel
              configured={Boolean(config)}
              isActive={config?.is_active ?? false}
              provider={
                config ? (PROVIDER_LABELS[config.provider] ?? config.provider) : null
              }
              senderNumber={config?.sender_number ?? null}
            />
          </CardContent>
        </Card>
        )}

        {canManageSending && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">SMS 발송 설정 (자사 공급자)</CardTitle>
          </CardHeader>
          <CardContent>
            <SmsConfigForm
              current={
                config
                  ? {
                      provider: config.provider,
                      senderNumber: config.sender_number,
                    }
                  : null
              }
            />
            <p className="mt-3 text-xs text-muted-foreground">
              대표가 ‘발송 설정·템플릿’ 관리 권한을 위임하면 해당 직원도 이 설정을
              변경할 수 있습니다 (기업 관리 → 시스템 설정·관리 권한 위임).
              업무·광고 문자는 여기 등록한 자사 공급자 계정으로 발송됩니다.
              전문가 로그인 인증번호는 플랫폼이 발송하므로 별도 설정이 필요
              없습니다.
            </p>
          </CardContent>
        </Card>
        )}

        {canManageSending && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">솔라피 연결 방법</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>
                솔라피(solapi.com)에 로그인 → <strong>발신번호 관리</strong>에서
                자사 번호를 사전등록합니다. 통신사 심사가 있어 즉시 완료되지
                않습니다.
              </li>
              <li>
                <strong>개발/연동 → API Key 관리</strong>에서 새 API 키를
                발급합니다. 캐스트로그 전용으로 하나 더 만들어 두면 나중에 이
                키만 폐기할 수 있습니다.
              </li>
              <li>
                발급 화면에 <strong>API Key</strong>와 <strong>API Secret</strong>
                이 함께 표시됩니다. Secret은 그 화면에서만 보이므로 즉시
                복사하세요.
              </li>
              <li>
                위 ‘SMS 발송 설정’에 공급자 <strong>솔라피</strong>, API Key, API
                Secret, 사전등록한 발신번호를 입력해 저장합니다.
              </li>
              <li>
                ‘SMS 연결 상태’에서 본인 휴대폰으로 <strong>테스트 발송</strong>
                해 확인합니다.
              </li>
            </ol>
            <p className="text-xs">
              API 키는 암호화되어 저장되며 저장 후에는 화면에 다시 표시되지
              않습니다. 키가 유출되었다고 판단되면 솔라피에서 해당 키를 폐기하고
              새 키로 다시 저장하세요.
            </p>
          </CardContent>
        </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">최초 설정 점검</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            가입 직후 반드시 잡아야 하는 설정(사용 기능·개인정보 보호책임자·임직원·
            문자 발송·전결규정 등)이 남아 있는지{" "}
            <Link
              href={`/${params.tenantSlug}/setup`}
              className="text-brand underline-offset-4 hover:underline"
            >
              최초 설정
            </Link>{" "}
            화면에서 한 번에 확인할 수 있습니다.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직원·직급 관리</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            직원 계정·직급·가입 신청 승인은{" "}
            <Link
              href={`/${params.tenantSlug}/admin/staff`}
              className="text-brand underline-offset-4 hover:underline"
            >
              임직원 설정
            </Link>
            에서, 전결규정은{" "}
            <Link
              href={`/${params.tenantSlug}/approvals/rules`}
              className="text-brand underline-offset-4 hover:underline"
            >
              전결규정
            </Link>
            에서 관리합니다.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
