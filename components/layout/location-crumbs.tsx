"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { buildCrumbs } from "@/lib/ui/nav-labels";

/** 상단 바 왼쪽 현재 위치 표시 — 경로에서 직접 만든다(페이지마다 넘기지 않는다). */
export function LocationCrumbs({
  tenantSlug,
  tenantName,
}: {
  tenantSlug: string;
  tenantName: string | null;
}) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname ?? "", tenantSlug);

  return (
    <nav
      aria-label="현재 위치"
      className="flex min-w-0 flex-1 items-center gap-1 text-sm"
    >
      {tenantName && (
        <>
          <Link
            href={`/${tenantSlug}/dashboard`}
            className="shrink-0 font-semibold text-brand-navy hover:text-brand"
          >
            {tenantName}
          </Link>
          {crumbs.length > 0 && (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </>
      )}
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span
            key={`${crumb.label}-${i}`}
            className="flex min-w-0 items-center gap-1"
          >
            {crumb.href && !isLast ? (
              <Link
                href={crumb.href}
                className="truncate text-muted-foreground hover:text-brand"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={
                  isLast
                    ? "truncate font-medium text-brand-navy"
                    : "truncate text-muted-foreground"
                }
                aria-current={isLast ? "page" : undefined}
              >
                {crumb.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
