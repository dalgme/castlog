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
  "checklist",
  "quote",
  "experts",
  "engage",
  "confirmed",
  "review",
  "contrib",
  "closing",
] as const;

export type ProjectTabKey = (typeof PROJECT_TAB_KEYS)[number];

const TAB_DEFS: readonly {
  key: ProjectTabKey;
  label: string;
  /** experts 모듈이 있어야 의미가 있는 탭 */
  needsExperts?: boolean;
  /** quotes(견적·정산) 모듈이 있어야 의미가 있는 탭 */
  needsQuotes?: boolean;
  /** 대표(ceo)·그 프로젝트 PM만 보는 탭 (기획 2026-09-21 — 참여율 배분) */
  execOnly?: boolean;
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
    // 체크리스트 (기획 지시 2026-09-05) — 기본설정 오른쪽. 공통 기반, 모듈 게이트 없음
    key: "checklist",
    label: "체크리스트",
    activeClass: "border-amber-600 bg-amber-600 text-white shadow-sm",
    idleClass:
      "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  },
  {
    // 견적·내부실견적·정산 (기획 지시 2026-09-09) — quotes 모듈
    key: "quote",
    label: "견적·정산",
    needsQuotes: true,
    activeClass: "border-rose-600 bg-rose-600 text-white shadow-sm",
    idleClass: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
  },
  // '세션 확인' 탭은 삭제 (기획 지시 2026-09-21) — 세션은 기본설정 캘린더·섭외후보 등록에서,
  // 안내문자는 섭외 확정 탭에서 전문가별로. 옛 링크(?tab=sessions)는 첫 탭으로 돌아간다
  {
    key: "experts",
    label: "섭외후보 등록",
    needsExperts: true,
    activeClass: "border-orange-600 bg-orange-600 text-white shadow-sm",
    idleClass:
      "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
  },
  {
    // 승인 목록 및 섭외 진행 (기획 확정 2026-08-30 — 37번): 품의가 승인된 뒤
    // 실제 섭외(문자 발송·수락서)를 하는 자리. 후보 등록과 실행을 탭으로 나눈다
    key: "engage",
    label: "승인 목록 및 섭외 진행",
    needsExperts: true,
    activeClass: "border-fuchsia-600 bg-fuchsia-600 text-white shadow-sm",
    idleClass:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100",
  },
  {
    // 섭외 확정 (기획 지시 2026-09-21) — 계약이 성립한 전문가 명단. 계획 인원이
    // 전원 승인되면 목표 달성으로 표시하고, 긴급 취소·세션별/전문가별 종료를 여기서 한다
    key: "confirmed",
    label: "섭외 확정",
    needsExperts: true,
    activeClass: "border-lime-600 bg-lime-600 text-white shadow-sm",
    idleClass: "border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100",
  },
  {
    // 리뷰 (기획 지시 2026-09-21) — 완료 사업 결과 요약·전문가 평가·운영 특이사항.
    // 회사 내부 기록이라 공통 기반, 모듈 게이트 없음 (전문가 평가 절만 experts에서 의미)
    key: "review",
    label: "리뷰",
    activeClass: "border-indigo-600 bg-indigo-600 text-white shadow-sm",
    idleClass:
      "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
  },
  {
    // 참여율 배분 — 종료 탭에서 분리 (기획 확정 2026-08-30). 공통 기반이라
    // 모듈 게이트 없음
    key: "contrib",
    label: "참여율 배분",
    execOnly: true,
    activeClass: "border-rose-600 bg-rose-600 text-white shadow-sm",
    idleClass:
      "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
  },
  {
    // 지급 품의 (기획 지시 2026-09-21) — 세션 단위 지급 품의·결재 상태·지급 완료·프로젝트 종료
    key: "closing",
    label: "지급 품의",
    activeClass: "border-emerald-600 bg-emerald-600 text-white shadow-sm",
    idleClass:
      "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  },
];

/** 쿼리 문자열을 탭 키로 — 모르는 값·모듈 꺼진 탭은 첫 탭으로 되돌린다 */
export function resolveProjectTab(
  raw: string | undefined,
  hasExperts: boolean,
  hasQuotes = true,
  /** 대표·PM 전용 탭(참여율 배분)을 볼 수 있는가 — 아니면 첫 탭으로 */
  canSeeExecOnly = true
): ProjectTabKey {
  const found = TAB_DEFS.find((t) => t.key === raw);
  if (!found) return "overview";
  if (found.needsExperts && !hasExperts) return "overview";
  if (found.needsQuotes && !hasQuotes) return "overview";
  if (found.execOnly && !canSeeExecOnly) return "overview";
  return found.key;
}

export function ProjectTabs({
  tenantSlug,
  projectId,
  active,
  hasExperts,
  hasQuotes = true,
  canSeeExecOnly = true,
}: {
  tenantSlug: string;
  projectId: string;
  active: ProjectTabKey;
  hasExperts: boolean;
  hasQuotes?: boolean;
  /** 참여율 배분 탭 — 대표(ceo)와 그 프로젝트 PM만 (기획 2026-09-21). 아니면 탭 자체를 숨긴다 */
  canSeeExecOnly?: boolean;
}) {
  const tabs = TAB_DEFS.filter(
    (t) =>
      (!t.needsExperts || hasExperts) &&
      (!t.needsQuotes || hasQuotes) &&
      (!t.execOnly || canSeeExecOnly)
  );

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
