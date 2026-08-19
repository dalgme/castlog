-- ============================================================================
-- 섭외수락서에 연습모드 구분을 붙인다
--
-- 왜: engagement_acceptances에는 is_practice가 없어서, 연습모드에서 만들어진
-- 가상 수락서가 실데이터 세션에서도 조회됐다. 연습 화면에서 만든 문서가 실제
-- 문서 목록에 섞이면 '연습'이라는 안전장치가 무너진다.
--
-- 스탬프는 JWT가 아니라 **섭외 건에서** 가져온다. 수락서 생성은 service_role
-- 경로(공개 링크 수락에는 세션이 없다)라 JWT를 볼 수 없기 때문이다.
-- ============================================================================

alter table public.engagement_acceptances
  add column if not exists is_practice boolean not null default false;

-- ---- 1. 섭외 건에서 모드를 가져오는 스탬프 ----------------------------------
create or replace function app.stamp_acceptance_practice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_practice boolean;
begin
  select is_practice into v_practice
  from public.expert_engagements
  where id = new.engagement_id;

  new.is_practice := coalesce(v_practice, false);
  return new;
end;
$$;

drop trigger if exists a_stamp_acceptance_practice
  on public.engagement_acceptances;
create trigger a_stamp_acceptance_practice
  before insert or update of engagement_id
  on public.engagement_acceptances
  for each row execute function app.stamp_acceptance_practice();

-- ---- 2. 기존 행 보정 ---------------------------------------------------------
update public.engagement_acceptances a
set is_practice = e.is_practice
from public.expert_engagements e
where e.id = a.engagement_id
  and a.is_practice is distinct from e.is_practice;

create index if not exists engagement_acceptances_practice_idx
  on public.engagement_acceptances (tenant_id, is_practice);

-- ---- 3. 모드 격리 (restrictive — 기존 permissive 정책과 AND) -----------------
-- 전문가 본인 열람 경로도 함께 걸린다. 가상 전문가에게는 로그인 계정이 없으므로
-- 실제 전문가가 자기 수락서를 못 보게 되는 일은 생기지 않는다.
drop policy if exists engagement_acceptances_practice_mode
  on public.engagement_acceptances;
create policy engagement_acceptances_practice_mode
  on public.engagement_acceptances
  as restrictive
  for select
  using (is_practice = app.is_practice());

comment on column public.engagement_acceptances.is_practice is
  '연습모드 수락서. 섭외 건(expert_engagements.is_practice)에서 파생된다.';
