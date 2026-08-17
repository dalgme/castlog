-- ============================================================================
-- 프로젝트 예산 + 섭외비 집계 기반
--
--  * 섭외 테이블(engagement_slots)에 슬롯별 1인 비용이 이미 있으므로,
--    예산과 대비해 계획비/확정비 소진 현황을 계산할 수 있다.
--  * 계획비 = Σ(슬롯 1인비용 × 필요인원), 확정비 = Σ(수락된 섭외 비용).
-- ============================================================================
alter table public.projects
  add column if not exists budget_amount bigint
    check (budget_amount is null or budget_amount >= 0);

comment on column public.projects.budget_amount is
  '프로젝트 총 예산(원). 섭외 계획비·확정비와 대비해 소진 현황을 계산한다.';
