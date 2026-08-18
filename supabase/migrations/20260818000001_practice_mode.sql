-- ============================================================================
-- 연습모드 (Practice Mode) — 기업 하위 계정이 실데이터를 건드리지 않고
-- 섭외 → 평가 → 완료품의 → 지급품의 전 과정을 연습하는 격리 환경.
--
-- 설계 판단:
--  * 별도 '연습 테넌트'를 만드는 방식은 채택하지 않는다. public.users의 PK가
--    auth user id라 한 사람이 두 테넌트에 프로필 행을 가질 수 없고, 테넌트를
--    바꾸면 자기 프로필조차 못 읽어 화면 전반이 깨진다.
--  * 대신 **같은 테넌트 안에서 is_practice 플래그로 분리**하고, 모드 자체를
--    JWT app_metadata.practice 에 둔다. 판정 근거를 JWT로 두는 것은 tenant_id와
--    동일한 원칙이며(CLAUDE.md §3), 앱 쿼리 한 줄 한 줄에 필터를 다는 대신
--    **RLS가 DB에서 강제**하므로 필터 누락으로 실데이터가 섞이는 사고가 없다.
--  * 같은 테넌트에 남기 때문에 직급(grade)·위임(tenant_admin_grants)·모듈 조합이
--    실제 설정 그대로 적용된다 — "설정해 둔 권한 범위만 연습" 요구가 자동 충족.
--
-- 규칙: 모든 대상 테이블의 SELECT 정책에 `is_practice = app.is_practice()` 를 건다.
--       평상시(false)에는 연습 데이터가 아예 보이지 않고, 연습모드(true)에서는
--       실데이터가 아예 보이지 않는다. 양방향 차단이다.
-- ============================================================================

-- ---- 1. 모드 판정 (JWT) ------------------------------------------------------
-- app_metadata.practice 가 true일 때만 연습모드. 없으면 false(실데이터).
create or replace function app.is_practice()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'practice', ''), '')::boolean,
    false
  )
$$;

revoke all on function app.is_practice() from public;
grant execute on function app.is_practice() to authenticated, anon;

comment on function app.is_practice() is
  '현재 세션이 연습모드인지 (JWT app_metadata.practice). 기본 false.';

-- ---- 2. 플래그 컬럼 ----------------------------------------------------------
-- SELECT 정책이 projects RLS를 타고 내려가지 않는 '뿌리' 테이블에만 단다.
alter table public.projects
  add column if not exists is_practice boolean not null default false;
alter table public.experts
  add column if not exists is_practice boolean not null default false;
alter table public.expert_tenant_links
  add column if not exists is_practice boolean not null default false;
alter table public.expert_engagements
  add column if not exists is_practice boolean not null default false;
alter table public.approvals
  add column if not exists is_practice boolean not null default false;
alter table public.expert_payment_batches
  add column if not exists is_practice boolean not null default false;
alter table public.expert_evaluations
  add column if not exists is_practice boolean not null default false;
alter table public.expert_reviews
  add column if not exists is_practice boolean not null default false;
alter table public.expert_tenant_tags
  add column if not exists is_practice boolean not null default false;

create index if not exists projects_practice_idx
  on public.projects (tenant_id, is_practice);
create index if not exists experts_practice_idx
  on public.experts (is_practice);

comment on column public.experts.is_practice is
  '연습모드 전용 가상 전문가. 실제 사람이 아니며 실데이터 세션에서는 보이지 않는다.';

-- ---- 3. 무결성: 연습 데이터와 실데이터를 섞지 못하게 한다 ---------------------
-- 실수로 실제 전문가를 연습 프로젝트에 넣거나 그 반대가 되면 연습 기록이 실제
-- 전문가의 이력에 남는다. 앱이 아니라 DB에서 막는다.
create or replace function app.enforce_engagement_practice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expert_practice boolean;
  v_project_practice boolean;
begin
  select is_practice into v_expert_practice
  from public.experts where id = new.expert_id;

  if v_expert_practice is distinct from new.is_practice then
    raise exception '연습 전문가와 실제 전문가를 섞을 수 없습니다.'
      using errcode = 'check_violation';
  end if;

  if new.project_id is not null then
    select is_practice into v_project_practice
    from public.projects where id = new.project_id;
    if v_project_practice is distinct from new.is_practice then
      raise exception '연습 프로젝트와 실제 프로젝트를 섞을 수 없습니다.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_engagement_practice on public.expert_engagements;
create trigger enforce_engagement_practice
  before insert or update of expert_id, project_id, is_practice
  on public.expert_engagements
  for each row execute function app.enforce_engagement_practice();

-- 연습 전문가는 연습 연결만 가질 수 있다.
create or replace function app.enforce_link_practice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expert_practice boolean;
begin
  select is_practice into v_expert_practice
  from public.experts where id = new.expert_id;
  if v_expert_practice is distinct from new.is_practice then
    raise exception '연습 전문가 연결 상태가 일치하지 않습니다.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_link_practice on public.expert_tenant_links;
create trigger enforce_link_practice
  before insert or update of expert_id, is_practice
  on public.expert_tenant_links
  for each row execute function app.enforce_link_practice();

-- ---- 4. 신규 행에 현재 모드를 자동 스탬프 -----------------------------------
-- 앱이 is_practice를 안 넘겨도 연습모드 세션이 만든 데이터는 연습으로 표시된다.
-- (service_role 시드는 값을 명시하므로 영향 없음 — 명시값이 우선한다)
create or replace function app.stamp_practice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_practice is null or new.is_practice = false then
    new.is_practice := app.is_practice();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'expert_engagements', 'approvals', 'expert_payment_batches',
    'expert_evaluations', 'expert_reviews', 'expert_tenant_tags'
  ] loop
    execute format('drop trigger if exists stamp_practice on public.%I', t);
    execute format(
      'create trigger stamp_practice before insert on public.%I
         for each row execute function app.stamp_practice()', t
    );
  end loop;
end $$;

-- ---- 5. can_view_project: 모드까지 일치해야 통과 ------------------------------
-- 이 함수는 SECURITY DEFINER라 projects RLS를 우회한다. 여기서 모드를 확인하지
-- 않으면 project_lifecycle_steps·contributions·evaluations가 모드를 넘나든다.
create or replace function app.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.tenant_id = app.tenant_id()
      and p.is_practice = app.is_practice()
      and (
        app.can_view_all_projects()
        or exists (
          select 1
          from public.project_assignments pa
          where pa.project_id = p.id
            and pa.user_id = auth.uid()
        )
      )
  )
$$;

-- ---- 6. SELECT 정책에 모드 조건 추가 -----------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    tenant_id = app.tenant_id()
    and is_practice = app.is_practice()
    and (
      app.can_view_all_projects()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = projects.id
          and pa.user_id = auth.uid()
      )
    )
  );

-- experts는 전역 테이블 — 기존 정책을 유지한 채 모드 조건만 덧댄다.
-- 기존 정책 이름·조건을 알 수 없는 경우를 대비해 제한 정책(restrictive)으로 건다.
-- restrictive 정책은 다른 모든 permissive 정책과 AND로 결합된다.
drop policy if exists experts_practice_mode on public.experts;
create policy experts_practice_mode on public.experts
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_tenant_links_practice_mode on public.expert_tenant_links;
create policy expert_tenant_links_practice_mode on public.expert_tenant_links
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_engagements_practice_mode on public.expert_engagements;
create policy expert_engagements_practice_mode on public.expert_engagements
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists approvals_practice_mode on public.approvals;
create policy approvals_practice_mode on public.approvals
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_payment_batches_practice_mode
  on public.expert_payment_batches;
create policy expert_payment_batches_practice_mode
  on public.expert_payment_batches
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_evaluations_practice_mode on public.expert_evaluations;
create policy expert_evaluations_practice_mode on public.expert_evaluations
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_reviews_practice_mode on public.expert_reviews;
create policy expert_reviews_practice_mode on public.expert_reviews
  as restrictive
  for select
  using (is_practice = app.is_practice());

drop policy if exists expert_tenant_tags_practice_mode on public.expert_tenant_tags;
create policy expert_tenant_tags_practice_mode on public.expert_tenant_tags
  as restrictive
  for select
  using (is_practice = app.is_practice());

-- ---- 7. 연습 전문가는 공개 프로필(/p) 대상이 아니다 --------------------------
-- 가상 전문가에게는 auth 계정이 없지만, 공개 프로필 경로가 뚫려 있으면
-- 검색엔진에 실존하지 않는 전문가가 노출된다. DB에서 아예 못 만들게 막는다.
create or replace function app.block_practice_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.experts e
    where e.id = new.expert_id and e.is_practice = true
  ) then
    raise exception '연습 전문가는 공개 프로필을 만들 수 없습니다.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists block_practice_public_profile
  on public.expert_public_profiles;
create trigger block_practice_public_profile
  before insert or update of expert_id on public.expert_public_profiles
  for each row execute function app.block_practice_public_profile();
