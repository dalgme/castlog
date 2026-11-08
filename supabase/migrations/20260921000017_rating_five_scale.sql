-- 자사 평점 10점 만점 → 5점 만점 (기획 지시 2026-11-08)
--
-- expert_tenant_profiles.rating(1~10)을 1~5로 바꾼다. 기존 값은 ceil(값/2)로 환산한다
-- (1~2→1, 3~4→2, 5~6→3, 7~8→4, 9~10→5). 프로젝트 평가(expert_evaluations.score)는 저장 10점·화면 5점
-- 구조를 그대로 두고(지급 게이트·평판 집계가 그 값을 본다) 표시만 5점 환산한다.
-- 멱등: 이미 5점 체계면 update는 0행, 제약 재작성은 같은 결과.

update public.expert_tenant_profiles
   set rating = ceil(rating / 2.0)::int
 where rating is not null and rating > 5;

alter table public.expert_tenant_profiles
  drop constraint if exists expert_tenant_profiles_rating_check;
alter table public.expert_tenant_profiles
  add constraint expert_tenant_profiles_rating_check check (rating is null or rating between 1 and 5);

comment on column public.expert_tenant_profiles.rating is '자사 평점 1~5 (2026-11-08, 종전 1~10은 ceil(/2) 환산)';
