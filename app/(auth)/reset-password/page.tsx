import Link from "next/link";

import { getSessionUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/auth-card";

import { ResetPasswordForm } from "./reset-form";

export const metadata = { title: "비밀번호 재설정" };

/**
 * 새 비밀번호 설정 — 이메일 링크가 /auth/confirm 에서 확인된 뒤 착지.
 * 세션이 없으면(직접 접근·만료) 재요청을 안내한다.
 */
export default async function ResetPasswordPage() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <AuthCard
        title="링크가 만료되었습니다"
        description="비밀번호 재설정 링크가 유효하지 않거나 만료되었습니다."
        footer={
          <p>
            <Link
              href="/forgot-password"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              재설정 메일 다시 받기
            </Link>
          </p>
        }
      >
        <p className="text-sm text-muted-foreground">
          보안을 위해 재설정 링크는 일정 시간이 지나면 만료됩니다. 아래에서 다시
          요청해 주세요.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="새 비밀번호 설정"
      description="사용하실 새 비밀번호를 입력해 주세요."
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
