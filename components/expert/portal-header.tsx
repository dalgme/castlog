import Link from "next/link";

import { Button } from "@/components/ui/button";

import { ExpertTabNav } from "./tab-nav";

/**
 * 전문가 포털 공통 헤더 — 홈(대시보드) 링크 + 로그아웃 + 상단 탭.
 * 인증된 포털 화면 전반에서 동일 노출 (로그인 화면 제외).
 */
export function PortalHeader({ showTabs = true }: { showTabs?: boolean }) {
  return (
    <div className="shadow-sm">
      <header className="flex h-14 items-center justify-between border-b bg-background px-5">
        <Link href="/expert" className="text-[15px] font-extrabold">
          전문가 포털
        </Link>
        <form method="post" action="/auth/logout">
          <Button type="submit" variant="ghost" size="sm">
            로그아웃
          </Button>
        </form>
      </header>
      {showTabs && <ExpertTabNav />}
    </div>
  );
}
