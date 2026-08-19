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
  BarChart3,
  Send,
  Settings,
  LogOut,
  Handshake,
  BookOpen,
  ListChecks,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { buildTenantPath } from "@/lib/routing/links";
import type { ModuleFlags, ModuleKey } from "@/lib/modules/modules";

/** module: null = 공통 기반(항상 노출), 그 외 = 해당 모듈 활성 시에만 노출 (CLAUDE.md 1-2) */
const NAV_ITEMS: readonly {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  module: ModuleKey | null;
  orgAdminOnly?: boolean;
  /** 지급(금액) 권한자에게만 — 대표·이사 또는 finance 위임자 */
  financeOnly?: boolean;
}[] = [
  { label: "대시보드", path: "dashboard", icon: LayoutDashboard, module: null },
  // 여러 프로젝트를 맡은 사람이 마감을 놓치지 않게 — 공통 기반
  { label: "내 업무", path: "my-work", icon: ListChecks, module: null },
  {
    label: "업무배정 현황",
    path: "executive",
    icon: BarChart3,
    module: null, // 프로젝트 기초 위의 통계 — 공통 기반
    orgAdminOnly: true,
  },
  // 프로젝트 개설·기본정보·PM배정·세션·코드넘버는 공통 기반 (CLAUDE.md §1-2)
  { label: "프로젝트", path: "projects", icon: FolderKanban, module: null },
  { label: "전자결재", path: "approvals", icon: FileCheck, module: "approvals" },
  // 전결규정은 '설정'이지 '프로젝트'가 아니다. 결재 현황(전자결재)과 규정 설정을
  // 분리하되, 규정은 자주 드나드는 화면이 아니므로 사이드바가 아니라
  // 설정 > 전결규정 탭에서만 연다 (기획 지시).
  { label: "전문가", path: "experts", icon: Users, module: "experts" },
  {
    label: "섭외 현황",
    path: "experts/engagements",
    icon: Handshake,
    module: "experts",
  },
  {
    label: "비용·지급",
    path: "payments",
    icon: Wallet,
    module: "experts",
    financeOnly: true,
  },
  { label: "보고서", path: "reports", icon: FileText, module: "operations" },
  { label: "발송", path: "messages", icon: Send, module: null },
  { label: "섭외 안내", path: "guide", icon: BookOpen, module: "experts" },
  { label: "설정", path: "settings", icon: Settings, module: null },
];

/** 테넌트 대시보드 공통 사이드바 (모바일: 조회 수준 대응 — 좁은 화면에서 아이콘만) */
export function Sidebar({
  tenantSlug,
  modules,
  isOrgAdmin,
  canManagePayments,
  tenantName,
  logoSrc,
}: {
  tenantSlug: string;
  modules: ModuleFlags;
  isOrgAdmin: boolean;
  canManagePayments: boolean;
  tenantName: string | null;
  /** 등록된 회사 로고 — 없으면 캐스트로그 심볼을 쓴다 */
  logoSrc: string | null;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (item.module === null || modules[item.module]) &&
      (!item.orgAdminOnly || isOrgAdmin) &&
      (!item.financeOnly || canManagePayments)
  );

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-14 shrink-0 flex-col self-start overflow-y-auto bg-brand-navy text-white/70 md:w-52">
      <Link
        href={buildTenantPath(tenantSlug, "dashboard")}
        className="flex items-center gap-2 px-4 py-5"
      >
        {/* 회사 로고가 등록돼 있으면 그것이 먼저다 — 직원이 매일 보는 화면은
            자기 회사의 화면이어야 한다. 없으면 캐스트로그 심볼로 돌아간다 */}
        {logoSrc ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt={tenantName ?? "회사 로고"}
              className="h-6 w-6 shrink-0 rounded bg-white object-contain p-0.5"
            />
            <span className="hidden truncate text-sm font-bold text-white md:inline">
              {tenantName ?? ""}
            </span>
          </>
        ) : (
          <>
            <LogoMark width={20} height={25} />
            <Wordmark invert className="hidden text-sm md:inline" />
          </>
        )}
      </Link>
      <nav className="flex flex-col gap-1 px-2">
        {visibleItems.map(({ label, path, icon: Icon }) => {
          const href = buildTenantPath(tenantSlug, path);
          // startsWith만 쓰면 /approvals/rules에서 '전자결재'와 '전결규정'이
          // 동시에 활성된다. 더 긴 경로가 있으면 그쪽만 활성으로 둔다.
          const active =
            pathname === href ||
            (pathname.startsWith(`${href}/`) &&
              !visibleItems.some(
                (other) =>
                  other.path !== path &&
                  other.path.startsWith(`${path}/`) &&
                  pathname.startsWith(buildTenantPath(tenantSlug, other.path))
              ));
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
      <form method="post" action="/auth/logout" className="mt-auto px-2 pb-4">
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden md:inline">로그아웃</span>
        </button>
      </form>
    </aside>
  );
}
