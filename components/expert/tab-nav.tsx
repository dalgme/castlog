"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * 전문가 포털 상단 탭 네비게이션 (설계문서 8.1 — 모바일 완전 대응 최우선).
 * 로그인 후 인증 화면 전반에서 동일하게 노출한다. 활성 탭은 현재 경로로 판정.
 */
const TABS: { href: string; label: string }[] = [
  { href: "/expert/engagements", label: "섭외 요청" },
  { href: "/expert/projects", label: "프로젝트별 관리" },
  { href: "/expert/history", label: "히스토리" },
  { href: "/expert/profile", label: "내 프로필" },
  { href: "/expert/documents", label: "서류함" },
];

export function ExpertTabNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-2 sm:px-4">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
