import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken } from "@/lib/auth/tokens";

import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata = {
  title: "수신거부",
  robots: { index: false, follow: false },
};

/**
 * 광고성 메시지 수신거부 공개 페이지 (설계문서 5.2 /u — 법적 필수).
 * 발송된 링크는 회수 불가하므로 토큰은 만료되지 않는다.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: { token: string };
}) {
  const shell = (body: React.ReactNode) => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/50 p-4">
      <div className="flex items-center gap-2.5">
        <LogoMark width={26} height={32} />
        <Wordmark className="text-lg" />
      </div>
      {body}
    </main>
  );

  if (!hasSupabaseEnv()) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>수신거부</CardTitle>
          <CardDescription>
            서버 설정이 완료되지 않아 처리를 진행할 수 없습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const admin = createAdminClient();
  const { data: record } = await admin
    .from("unsubscribe_tokens")
    .select("id, tenant_id, channel, tenants (name)")
    .eq("token_hash", hashLinkToken(params.token))
    .maybeSingle();

  if (!record) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>수신거부</CardTitle>
          <CardDescription>
            유효하지 않은 수신거부 링크입니다. 링크를 다시 확인해 주세요.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return shell(
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>광고성 메시지 수신거부</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">
            {record.tenants?.name ?? "발송처"}
          </span>
          의 광고성 {record.channel === "email" ? "이메일" : "문자"} 수신을
          거부합니다. 아래 버튼을 누르면 즉시 처리되며 비용은 무료입니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UnsubscribeButton token={params.token} />
      </CardContent>
    </Card>
  );
}
