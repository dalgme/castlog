import Link from "next/link";

import { getSessionUser, postLoginPath } from "@/lib/auth/session";
import { roleFromUser } from "@/lib/auth/tenant";

/**
 * 랜딩 헤더 우측 버튼 — 로그인 상태를 반영한다.
 *
 * 이미 로그인한 사람에게 계속 '로그인'만 보이면, 자기가 로그인돼 있는지 알 수
 * 없고 자기 화면으로 돌아갈 길도 없다. 세션이 있으면 이름과 '내 화면으로'를
 * 보여준다.
 *
 * 세션 확인은 쿠키를 읽으므로 이 페이지는 동적 렌더가 된다. 로그인 상태를
 * 정확히 보여주는 쪽이 정적 캐시보다 중요하다.
 */
export async function LandingHeaderActions() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="header-actions">
        <Link className="btn-login" href="/login">
          로그인
        </Link>
        <Link className="btn-trial" href="/contact?type=trial&source=header">
          무료 체험 신청
        </Link>
      </div>
    );
  }

  const role = roleFromUser(user);
  const label =
    role === "expert"
      ? "전문가 포털"
      : role === "platform_admin"
        ? "관리모드"
        : "내 화면으로";

  return (
    <div className="header-actions">
      <span className="header-user" title={user.email ?? undefined}>
        {user.email ?? "로그인됨"}
      </span>
      <Link className="btn-trial" href={postLoginPath(user)}>
        {label}
      </Link>
      <form method="post" action="/auth/logout">
        <button type="submit" className="btn-login">
          로그아웃
        </button>
      </form>
    </div>
  );
}
