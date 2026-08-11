import { redirect } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth/schemas";

export const metadata = { title: "전문가 로그인" };

/**
 * 전문가 로그인은 통합 로그인 화면(/login)의 '전문가' 탭으로 일원화됐다.
 * 인쇄물·기존 링크 호환을 위해 이 경로는 유지하되 탭 선택 상태로 리다이렉트한다.
 */
export default function ExpertLoginRedirect({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = sanitizeNextPath(searchParams.next);
  const params = new URLSearchParams({ tab: "expert" });
  if (next) params.set("next", next);
  redirect(`/login?${params.toString()}`);
}
