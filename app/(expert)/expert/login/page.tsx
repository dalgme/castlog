import Link from "next/link";
import { redirect } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth/schemas";
import { getSessionUser, postLoginPath } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/auth-card";

import { ExpertLoginForm } from "./login-form";

export const metadata = { title: "전문가 로그인" };

/** 전문가 로그인 — 휴대폰 OTP. 직원은 /login (이메일). */
export default async function ExpertLoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const user = await getSessionUser();
  if (user) {
    redirect(sanitizeNextPath(searchParams.next) ?? postLoginPath(user));
  }

  return (
    <AuthCard
      title="전문가 로그인"
      description="휴대폰 번호 인증으로 로그인하세요."
      footer={
        <p>
          기업 소속이신가요?{" "}
          <Link href="/login" className="font-medium text-brand underline-offset-4 hover:underline">
            이메일로 로그인
          </Link>
        </p>
      }
    >
      <ExpertLoginForm next={sanitizeNextPath(searchParams.next)} />
    </AuthCard>
  );
}
