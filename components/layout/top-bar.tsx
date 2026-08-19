import { LogOut } from "lucide-react";

import { getSessionUser } from "@/lib/auth/session";
import { gradeFromUser } from "@/lib/auth/tenant";
import { gradeLabel } from "@/lib/auth/grades";

import { LocationCrumbs } from "./location-crumbs";
import { PracticeToggle } from "./practice-toggle";

/**
 * 대시보드 상단 바 — 왼쪽 현재 위치, 오른쪽 계정·로그아웃.
 *
 * 사이드바만으로는 "지금 어디에 있는지"가 화면 안에서 드러나지 않고, 로그아웃도
 * 사이드바 맨 아래까지 내려가야 나왔다. 현재 위치와 나가는 문은 항상 같은 자리에
 * 있어야 한다.
 */
export async function TopBar({
  tenantSlug,
  tenantName,
  practice,
  canPractice,
}: {
  tenantSlug: string;
  tenantName: string | null;
  practice: boolean;
  /** 연습모드를 쓸 수 있는 사람인가 (플랫폼관리자는 테넌트 소속이 아니라 제외) */
  canPractice: boolean;
}) {
  const user = await getSessionUser();
  const grade = gradeFromUser(user);

  return (
    // sticky — 목록이 길어져도 현재 위치와 나가는 문은 화면에서 사라지지 않는다.
    // (사이드바도 함께 고정한다 — 위쪽만 남고 메뉴가 사라지면 더 헷갈린다)
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-white px-4">
      <LocationCrumbs tenantSlug={tenantSlug} tenantName={tenantName} />

      <div className="flex shrink-0 items-center gap-2">
        {/* 연습모드는 '지금 내가 어떤 자리에 있는가'라서 계정 옆이 제자리다 */}
        {canPractice && <PracticeToggle practice={practice} />}
        {user?.email && (
          <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:inline">
            {user.email}
            {grade ? ` · ${gradeLabel(grade)}` : ""}
          </span>
        )}
        <form method="post" action="/auth/logout">
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-brand-navy transition-colors hover:border-brand hover:text-brand"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            로그아웃
          </button>
        </form>
      </div>
    </header>
  );
}
