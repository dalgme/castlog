"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * 설정 탭 — SMS 설정 · 기업관리 · 전결규정.
 *
 * 세 화면은 원래 서로 다른 경로에 있고 권한 게이트도 다르다(발송 위임 / 직원·설정
 * 위임 / approvals 모듈). 한 페이지에 억지로 합치면 게이트가 섞여 구멍이 생기므로,
 * 화면은 그대로 두고 이동 경로만 탭으로 묶는다. 권한이 없는 탭은 아예 그리지 않는다.
 */
export function SettingsTabs({
  tenantSlug,
  showSms,
  showOrg,
  showRules,
}: {
  tenantSlug: string;
  showSms: boolean;
  showOrg: boolean;
  showRules: boolean;
}) {
  const pathname = usePathname();

  const tabs = [
    {
      key: "sms",
      label: "SMS 설정",
      href: `/${tenantSlug}/settings`,
      show: showSms,
    },
    {
      key: "org",
      label: "기업관리",
      href: `/${tenantSlug}/admin/org`,
      show: showOrg,
    },
    {
      key: "rules",
      label: "전결규정",
      href: `/${tenantSlug}/approvals/rules`,
      show: showRules,
    },
  ].filter((t) => t.show);

  if (tabs.length < 2) return null;

  return (
    <nav className="flex flex-wrap gap-1 border-b bg-white px-5 pt-3">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-border bg-white text-brand"
                : "border-transparent text-muted-foreground hover:text-brand"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
