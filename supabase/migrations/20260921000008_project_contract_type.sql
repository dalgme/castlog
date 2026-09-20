-- 프로젝트 계약 처리 구분 (기획 지시 2026-09-21) — 리뷰 탭의 '계약 처리 구분(수의/입찰)'을
-- 프로젝트 생성 '기본정보'에서 고르고, 몰랐으면 '기본정보 수정'에서 나중에 정한다.
-- private = 수의 계약 / bid = 입찰 / null = 미정.
-- 추가 전용·멱등 (§14-10 "SQL 먼저"). 코드는 컬럼 부재(42703·PGRST204)를 폴백한다.

alter table public.projects
  add column if not exists contract_type text;

alter table public.projects
  drop constraint if exists projects_contract_type_check;
alter table public.projects
  add constraint projects_contract_type_check
  check (contract_type is null or contract_type in ('private', 'bid'));

comment on column public.projects.contract_type is
  '계약 처리 구분 (기획 2026-09-21): private=수의 계약, bid=입찰, null=미정';
