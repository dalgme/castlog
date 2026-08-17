import { sanitizeNextPath } from "@/lib/auth/schemas";
import { getSessionUser, postLoginPath } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";
import { AuthCard } from "@/components/auth/auth-card";

import { LoginTabs } from "./login-tabs";
import { AlreadySignedIn } from "./already-signed-in";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "플랫폼 관리자",
  org_admin: "기업 대표",
  manager: "기업 관리자",
  staff: "기업 담당자",
  expert: "전문가",
};

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
  // 이미 로그인돼 있으면 말없이 튕기지 않고 어디로 갈지 고르게 한다.
  // (랜딩 '로그인' → 다른 계정으로 들어가려던 사용자가 기존 세션 홈으로
  //  끌려가는 문제. 계정 전환 경로가 없으면 로그아웃할 방법도 없다.)
  const user = await getSessionUser();
  if (user) {
    const role = roleFromUser(user);
    return (
      <AuthCard
        title="이미 로그인되어 있습니다"
        description="현재 계정으로 계속하거나 다른 계정으로 로그인하세요."
      >
        <AlreadySignedIn
          accountLabel={user.email ?? user.phone ?? "로그인된 계정"}
          roleLabel={(role && ROLE_LABELS[role]) ?? "사용자"}
          continueHref={sanitizeNextPath(searchParams.next) ?? postLoginPath(user)}
        />
      </AuthCard>
    );
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
