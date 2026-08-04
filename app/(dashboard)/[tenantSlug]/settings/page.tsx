import Link from "next/link";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { PageHeader } from "@/components/layout/header";
import { EmptyState } from "@/components/layout/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { SmsConfigForm } from "./sms-config-form";

export const metadata = { title: "설정" };

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
