-- 섭외 확정 탭 · 세션별/전문가별 종료 (기획 지시 2026-09-21)
--
-- 섭외가 확정(계약 성립)된 전문가와 세션을 담당자가 '종료'로 표시한다.
-- 삭제·상태 전환이 아니라 시각을 남기는 추가 컬럼이다 (§14-4 삭제보다 비활성화).
-- 추가 전용·멱등 (§14-10 "SQL 먼저"). 코드는 컬럼 부재(42703)를 폴백한다.

alter table public.expert_engagements
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid;

alter table public.engagement_slots
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid;

comment on column public.expert_engagements.completed_at is
  '전문가별 종료 시각 — 섭외 확정 탭의 종료 버튼 (기획 2026-09-21). null = 진행 중';
comment on column public.expert_engagements.completed_by is
  '종료 처리한 직원(auth user id)';
comment on column public.engagement_slots.completed_at is
  '세션별 종료 시각 — 섭외 확정 탭의 세션 종료 버튼 (기획 2026-09-21). null = 진행 중';
comment on column public.engagement_slots.completed_by is
  '종료 처리한 직원(auth user id)';
