import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { formatKrMobile } from "@/lib/auth/phone";
import { lookupInvitationByToken } from "@/lib/experts/invitations";

import { ExpertJoinForm } from "./join-form";

export const metadata = {
  title: "전문가 등록",
  robots: { index: false, follow: false },
};

const INVALID_MESSAGES: Record<string, string> = {
  not_found: "존재하지 않는 등록 링크입니다. 링크를 다시 확인해 주세요.",
  expired: "등록 링크의 유효기간이 지났습니다. 기업 담당자에게 새 링크를 요청하세요.",
  already_used: "이미 사용된 등록 링크입니다. 로그인은 전문가 로그인에서 진행하세요.",
  revoked: "회수된 등록 링크입니다. 기업 담당자에게 새 링크를 요청하세요.",
};

/**
 * 전문가 등록 공개 페이지 (설계문서 3.2) — 로그인 불필요, 모바일 완전 대응.
 * 토큰 검증은 서버(service_role)에서만 수행한다.
 */
export default async function ExpertJoinPage({
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
          <CardTitle>전문가 등록</CardTitle>
          <CardDescription>
            서버 설정이 완료되지 않아 등록을 진행할 수 없습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lookup = await lookupInvitationByToken(params.token);

  if (!lookup.ok) {
    return shell(
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>전문가 등록</CardTitle>
          <CardDescription>{INVALID_MESSAGES[lookup.reason]}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { invitation, tenantName } = lookup;

  return shell(
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>전문가 등록</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{tenantName}</span>
          의 전문가 풀 등록 요청입니다. 휴대폰 인증 후 프로필을 입력하면 등록이
          완료됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ExpertJoinForm
          token={params.token}
          invitedName={invitation.invited_name}
          invitedPhone={
            invitation.invited_phone
              ? formatKrMobile(invitation.invited_phone)
              : null
          }
        />
      </CardContent>
    </Card>
  );
}
