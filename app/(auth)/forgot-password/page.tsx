import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";

import { ForgotPasswordForm } from "./forgot-form";

export const metadata = { title: "비밀번호 찾기" };

/**
 * 기업회원 비밀번호 재설정 요청 — 이메일로 재설정 링크 발송.
 * 만료·사용된 링크(/auth/confirm 실패)도 여기로 온다 — 이유를 말해 주지 않으면
 * 링크를 누른 사람은 자기가 왜 이 화면에 있는지 모른다.
 */
export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const expired = searchParams?.error === "link_expired";
  return (
    <AuthCard
      title="비밀번호 찾기"
      description={
        expired
          ? "링크가 만료되었거나 이미 사용되었습니다. 아래에서 새 링크를 받으세요."
          : "가입한 이메일로 비밀번호 재설정 링크를 보내드립니다."
      }
      footer={
        <p>
          <Link
            href="/login"
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            로그인으로 돌아가기
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
