import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  await requireRole(["org_admin", "platform_admin"]);

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

  return (
    <div>
      <PageHeader title="설정" />
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-5">
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
              업무·광고 문자는 여기 등록한 자사 공급자 계정으로 발송됩니다.
              전문가 로그인 인증번호는 플랫폼이 발송하므로 별도 설정이 필요
              없습니다.
            </p>
          </CardContent>
        </Card>

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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">직원·직급 관리</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            직원 계정과 직급은{" "}
            <Link
              href={`/${params.tenantSlug}/admin/org`}
              className="text-brand underline-offset-4 hover:underline"
            >
              기업 관리
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
