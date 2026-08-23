import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * 프로젝트 상세 탭.
 *
 * 한 페이지에 기본정보·배정·예산·세션·섭외·평가·품의·21스텝이 세로로 다 늘어서
 * 있으면, 지금 무슨 일을 하러 들어왔는지가 스크롤에 묻힌다. 작업 단위로 나눈다.
 *
 * 탭은 URL 쿼리(?tab=)로 정한다 — 새로고침·뒤로가기·링크 공유가 그대로 살아 있고,
 * 서버 액션 후 revalidate 되어도 보던 탭에 머문다.
 */

export const PROJECT_TAB_KEYS = [
  "overview",
  "basic",
  "sessions",
  "experts",
  "closing",
] as const;

export type ProjectTabKey = (typeof PROJECT_TAB_KEYS)[number];

const TAB_DEFS: readonly {
  key: ProjectTabKey;
  label: string;
  /** experts 모듈이 있어야 의미가 있는 탭 */
  needsExperts?: boolean;
  /** 탭 고유색 (기획 확정 2026-08-22) — Tailwind는 리터럴 클래스만 인식한다 */
  activeClass: string;
  idleClass: string;
}[] = [
  {
    key: "overview",
    label: "프로젝트 현황 대시보드",
    activeClass: "border-sky-600 bg-sky-600 text-white shadow-sm",
    idleClass:
      "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
  },
  {
    key: "basic",
    label: "기본설정",
    activeClass: "border-teal-600 bg-teal-600 text-white shadow-sm",
    idleClass:
      "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100",
  },
  {
    key: "sessions",
    label: "세션 계획 등록",
    activeClass: "border-violet-600 bg-violet-600 text-white shadow-sm",
    idleClass:
      "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
  },
  {
    key: "experts",
    label: "섭외후보 등록",
    needsExperts: true,
    activeClass: "border-orange-600 bg-orange-600 text-white shadow-sm",
    idleClass:
      "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
  },
  {
    key: "closing",
    label: "프로젝트 종료 및 지급 품의",
    activeClass: "border-emerald-600 bg-emerald-600 text-white shadow-sm",
    idleClass:
      "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  },
];

/** 쿼리 문자열을 탭 키로 — 모르는 값·모듈 꺼진 탭은 첫 탭으로 되돌린다 */
export function resolveProjectTab(
  raw: string | undefined,
  hasExperts: boolean
): ProjectTabKey {
  const found = TAB_DEFS.find((t) => t.key === raw);
  if (!found) return "overview";
  if (found.needsExperts && !hasExperts) return "overview";
  return found.key;
}

export function ProjectTabs({
  tenantSlug,
  projectId,
  active,
  hasExperts,
}: {
  tenantSlug: string;
  projectId: string;
  active: ProjectTabKey;
  hasExperts: boolean;
}) {
  const tabs = TAB_DEFS.filter((t) => !t.needsExperts || hasExperts);

  return (
    <nav className="flex flex-wrap gap-1 border-b bg-white px-5 pt-3">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/${tenantSlug}/projects/${projectId}?tab=${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors",
              isActive ? tab.activeClass : tab.idleClass
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
