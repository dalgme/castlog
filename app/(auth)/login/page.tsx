import Link from "next/link";
import { redirect } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth/schemas";
import { getSessionUser, postLoginPath } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/auth-card";

import { StaffLoginForm } from "./login-form";

export const metadata = { title: "로그인" };

/** 직원(기업 소속) 로그인 — 이메일 기반. 전문가는 /expert/login (휴대폰 인증). */
export default async function LoginPage({
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
      title="로그인"
      description="기업 계정(이메일)으로 로그인하세요."
      footer={
        <p>
          전문가이신가요?{" "}
          <Link href="/expert/login" className="font-medium text-brand underline-offset-4 hover:underline">
            휴대폰 인증으로 로그인
          </Link>
        </p>
      }
    >
      <StaffLoginForm next={sanitizeNextPath(searchParams.next)} />
    </AuthCard>
  );
}
