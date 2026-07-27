"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  FileCheck,
  Users,
  Wallet,
  FileText,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { buildTenantPath } from "@/lib/routing/links";

const NAV_ITEMS = [
  { label: "대시보드", path: "dashboard", icon: LayoutDashboard },
  { label: "프로젝트", path: "projects", icon: FolderKanban },
  { label: "전자결재", path: "approvals", icon: FileCheck },
  { label: "전문가", path: "experts", icon: Users },
  { label: "비용·지급", path: "payments", icon: Wallet },
  { label: "보고서", path: "reports", icon: FileText },
  { label: "설정", path: "settings", icon: Settings },
] as const;

/** 테넌트 대시보드 공통 사이드바 (모바일: 조회 수준 대응 — 좁은 화면에서 아이콘만) */
export function Sidebar({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col bg-brand-navy text-white/70 md:w-52">
      <Link
        href={buildTenantPath(tenantSlug, "dashboard")}
        className="flex items-center gap-2 px-4 py-5"
      >
        <LogoMark width={20} height={25} />
        <Wordmark invert className="hidden text-sm md:inline" />
      </Link>
      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const href = buildTenantPath(tenantSlug, path);
          const active = pathname.startsWith(href);
          return (
            <Link
              key={path}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand text-white"
                  : "hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
