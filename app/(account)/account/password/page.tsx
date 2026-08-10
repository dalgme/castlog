import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth/auth-card";

import { ChangeInitialPasswordForm } from "./change-form";

export const metadata = { title: "비밀번호 변경" };

/**
 * 단계 30: 최초 로그인 비밀번호 강제 변경 페이지.
 * 미들웨어가 must_change_password 사용자를 이 경로로 보낸다.
 * 플래그가 없는 사용자가 직접 들어오면 홈으로 돌려보낸다.
 */
export default async function AccountPasswordPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AuthCard
      title="비밀번호를 변경해 주세요"
      description="관리자가 발급한 임시 비밀번호로 로그인하셨습니다. 보안을 위해 새 비밀번호를 설정한 뒤 이용할 수 있습니다."
    >
      <ChangeInitialPasswordForm />
    </AuthCard>
  );
}
