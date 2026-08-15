"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Inbox,
  FolderKanban,
  History,
  User,
  FolderArchive,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 전문가 포털 상단 탭 네비게이션 (설계문서 8.1 — 모바일 완전 대응 최우선).
 * 홈(대시보드)을 첫 탭으로 두고, 섭외 중심으로 구성. 활성 탭은 현재 경로로 판정.
 */
const TABS: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] =
  [
    { href: "/expert", label: "홈", icon: Home, exact: true },
    { href: "/expert/engagements", label: "섭외 요청", icon: Inbox },
    { href: "/expert/projects", label: "프로젝트별 관리", icon: FolderKanban },
    { href: "/expert/history", label: "히스토리", icon: History },
    { href: "/expert/profile", label: "내 프로필", icon: User },
    { href: "/expert/documents", label: "서류함", icon: FolderArchive },
  ];

export function ExpertTabNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-background">
      <div className="mx-auto flex max-w-4xl gap-0.5 overflow-x-auto px-2 sm:px-6">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-brand-navy"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
