"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * 설정 탭 — 내 설정 · 임직원 설정 · SMS 설정 · 기업관리 · 전결규정.
 *
 * '내 설정'은 등급과 무관하게 항상 있다. 대리 이하에게 설정이 하나도 없으면
 * 자기 연락처를 고치는 것조차 관리자에게 부탁해야 한다.
 *
 * 전결규정은 사이드바에서 뺐다 — 매일 드나드는 화면이 아니라 한 번 정해 두고
 * 가끔 고치는 '설정'이기 때문이다. 대신 여기 탭이 유일한 진입 경로가 된다.
 * (전결규정 설정 ↔ 프로젝트 현황관리는 여전히 별개 화면이다.)
 *
 * 세 화면은 원래 서로 다른 경로에 있고 권한 게이트도 다르다(발송 위임 / 직원·설정
 * 위임 / approvals 모듈). 한 페이지에 억지로 합치면 게이트가 섞여 구멍이 생기므로,
 * 화면은 그대로 두고 이동 경로만 탭으로 묶는다. 권한이 없는 탭은 아예 그리지 않는다.
 */
export function SettingsTabs({
  tenantSlug,
  showStaff,
  showSms,
  showOrg,
  showRules,
}: {
  tenantSlug: string;
  showStaff?: boolean;
  showSms: boolean;
  showOrg: boolean;
  showRules: boolean;
}) {
  const pathname = usePathname();

  const tabs = [
    {
      // 등급과 무관하게 누구나 갖는 설정 — 항상 첫 탭
      key: "me",
      label: "내 설정",
      href: `/${tenantSlug}/settings/me`,
      show: true,
    },
    {
      // 사람에 관한 것은 여기 하나로 모은다 — 가입 신청·계정·직급·권한 위임.
      // 회사에 관한 것(기업정보·세무·카테고리)은 '기업관리'에 남는다.
      key: "staff",
      label: "임직원 설정",
      href: `/${tenantSlug}/admin/staff`,
      show: Boolean(showStaff),
    },
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
