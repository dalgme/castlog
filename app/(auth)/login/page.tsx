import { redirect } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth/schemas";
import { getSessionUser, postLoginPath } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/auth-card";

import { LoginTabs } from "./login-tabs";

export const metadata = { title: "로그인" };

/**
 * 통합 로그인 — 기업회원(이메일) / 전문가(휴대폰 인증) 탭.
 * ?tab=expert 로 전문가 탭을 기본 선택할 수 있다 (/expert/login 이 이리로 유도).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; tab?: string };
}) {
  const user = await getSessionUser();
  if (user) {
    redirect(sanitizeNextPath(searchParams.next) ?? postLoginPath(user));
  }

  const defaultTab = searchParams.tab === "expert" ? "expert" : "org";

  return (
    <AuthCard
      title="로그인"
      description="계정 유형을 선택해 로그인하세요."
    >
      <LoginTabs
        next={sanitizeNextPath(searchParams.next)}
        defaultTab={defaultTab}
      />
    </AuthCard>
  );
}
