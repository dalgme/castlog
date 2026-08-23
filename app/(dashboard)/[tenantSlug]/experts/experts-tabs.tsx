import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * 전문가 메뉴 탭 (기획 확정 2026-08-23).
 * 목록 · 전문가 관리 · 일괄 등록 — 일괄 등록(엑셀·보유자료·파일)은
 * 헤더 버튼이 아니라 탭으로 승격한다. 경로 이동형 탭이라 새로고침·공유에 안전.
 */

export type ExpertsTabKey = "list" | "manage" | "import";

const TABS: readonly { key: ExpertsTabKey; label: string; path: string }[] = [
  { key: "list", label: "전문가 목록", path: "" },
  { key: "manage", label: "전문가 관리", path: "/manage" },
  { key: "import", label: "일괄 등록", path: "/import" },
];

export function ExpertsTabs({
  tenantSlug,
  active,
}: {
  tenantSlug: string;
  active: ExpertsTabKey;
}) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="전문가 메뉴 탭">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${tenantSlug}/experts${tab.path}`}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            active === tab.key
              ? "border-brand bg-brand text-white shadow-sm"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          )}
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
