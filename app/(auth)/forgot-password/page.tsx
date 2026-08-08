import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";

import { ForgotPasswordForm } from "./forgot-form";

export const metadata = { title: "비밀번호 찾기" };

/** 기업회원 비밀번호 재설정 요청 — 이메일로 재설정 링크 발송. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="비밀번호 찾기"
      description="가입한 이메일로 비밀번호 재설정 링크를 보내드립니다."
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
