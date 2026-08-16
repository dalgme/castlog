"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, FolderArchive, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/expert/profile", label: "내 프로필", icon: User },
  { href: "/expert/documents", label: "서류함", icon: FolderArchive },
];

/**
 * 앱바 우측(로그아웃 왼쪽) 빠른 이동 링크 — 내 프로필·서류함.
 * 탭 줄에서 헤더로 옮겨 상시 접근성을 높인다. 활성 경로 강조 + 미읽음 뱃지.
 */
export function HeaderQuickLinks({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const badge = badges[href] ?? 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:bg-muted hover:text-brand-navy"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            {badge > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-amber px-1 text-[10px] font-bold leading-none text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
