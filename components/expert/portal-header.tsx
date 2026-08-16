import Link from "next/link";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getExpertUnreadCount } from "@/lib/experts/notifications";

import { ExpertTabNav } from "./tab-nav";

/**
 * 전문가 포털 공통 앱바 — CASTLOG 브랜드(로고·워드마크) + "전문가 섭외 포털" 정체성
 * + 로그아웃 + 상단 탭. 헤더 안쪽 폭을 콘텐츠와 동일 컨테이너로 맞춰 정렬을 통일한다.
 * 인증된 포털 화면 전반에서 동일 노출(로그인 화면 제외). 모바일 완전 대응.
 */
export async function PortalHeader({ showTabs = true }: { showTabs?: boolean }) {
  const unreadCount = showTabs ? await getExpertUnreadCount() : 0;
  return (
    <div className="sticky top-0 z-20 bg-background shadow-sm">
      <div className="border-b">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/expert" className="flex items-center gap-2.5">
            <LogoMark width={24} height={30} />
            <span className="flex items-baseline gap-2">
              <Wordmark className="text-base" />
              <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
                전문가 섭외 포털
              </span>
            </span>
          </Link>
          <form method="post" action="/auth/logout">
            <Button type="submit" variant="ghost" size="sm">
              로그아웃
            </Button>
          </form>
        </div>
      </div>
      {showTabs && <ExpertTabNav unreadCount={unreadCount} />}
    </div>
  );
}
