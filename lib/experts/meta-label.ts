/**
 * "OO대학교 · 교수 · 1975년생" — 후보 목록·진행 표·현황판이 같은 표기를 쓴다 (기획 지시 2026-11-08).
 *
 * 서버·클라이언트 공용 순수 함수. **'use client' 모듈에 두지 않는다** — 서버 컴포넌트가 클라이언트 모듈의
 * 함수를 import하면 함수가 아니라 클라이언트 참조(프록시)가 들어와 호출 시 "is not a function"으로
 * 페이지 전체가 죽는다 (핫픽스 2026-11-11: 프로젝트 상세 진입 불가).
 */
export function expertMetaLabel(
  e: { organization?: string | null; job_title?: string | null; birth_year?: number | null } | null | undefined
): string | null {
  if (!e) return null;
  const parts = [e.organization, e.job_title, e.birth_year != null ? `${e.birth_year}년생` : null].filter(
    (v): v is string => Boolean(v)
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}
