-- ============================================================================
-- 프로젝트 역할별 최소 레벨 — 회사 설정 (기획 확정 2026-08-23)
--
-- 기본값: PL=레벨 3(team_lead) · PM=레벨 4(deputy) · 부PM=레벨 5(senior) ·
--         담당=레벨 6(staff, 사실상 제한 없음).
-- ※ 부PM 기본값이 기존 레벨 4에서 레벨 5로 완화된다 (기획 지시 2026-08-23).
-- 회사는 tenant_assignment_role_rules로 역할마다 다른 레벨을 적용할 수 있다.
-- PL·PM 겸임(pl_pm)은 별도 설정 없이 PL·PM 중 높은 쪽을 자동으로 따른다.
-- 앱은 lib/integrations/assignment-role-rules.ts가 같은 규칙으로 먼저 걸러
-- 친절한 문구를 돌려주고, 이 트리거가 최종 강제한다.
-- ============================================================================

-- ---- 0. 설정 테이블 ----------------------------------------------------------

create table if not exists public.tenant_assignment_role_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assignment_role text not null,
  min_grade text not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, assignment_role),
  constraint tenant_assignment_role_rules_role_check check (assignment_role in (
    'pl', 'pm', 'deputy_pm', 'member'
  )),
  constraint tenant_assignment_role_rules_grade_check check (min_grade in (
    'ceo', 'director', 'team_lead', 'deputy', 'senior', 'staff'
  ))
);

alter table public.tenant_assignment_role_rules enable row level security;

-- 조회: 테넌트 직원 (전문가 세션 제외 — 내부 권한 구성) / 쓰기: staff 스코프
drop policy if exists tenant_assignment_role_rules_select on public.tenant_assignment_role_rules;
create policy tenant_assignment_role_rules_select on public.tenant_assignment_role_rules
  for select using (
    tenant_id = app.tenant_id() and app.user_role() <> 'expert'
  );

drop policy if exists tenant_assignment_role_rules_write on public.tenant_assignment_role_rules;
create policy tenant_assignment_role_rules_write on public.tenant_assignment_role_rules
  for all using (tenant_id = app.tenant_id() and app.has_admin_scope('staff'))
  with check (tenant_id = app.tenant_id() and app.has_admin_scope('staff'));

comment on table public.tenant_assignment_role_rules is
  '프로젝트 역할(PL·PM·부PM·담당)별 최소 권한 레벨의 회사 조정값 — 미설정 역할은 기본값.';

-- ---- 1. 판정 함수 ------------------------------------------------------------

-- 기본 최소 레벨 — lib/integrations/assignment-role-rules.ts와 반드시 동일 유지
create or replace function app.assignment_role_default_min(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'pl'        then 'team_lead'
    when 'pm'        then 'deputy'
    when 'deputy_pm' then 'senior'
    when 'member'    then 'staff'
    else 'ceo' -- 모르는 역할은 가장 좁게
  end
$$;

create or replace function app.assignment_role_min_grade(p_role text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.min_grade
       from public.tenant_assignment_role_rules r
      where r.tenant_id = app.tenant_id()
        and r.assignment_role = p_role),
    app.assignment_role_default_min(p_role)
  )
$$;

revoke all on function app.assignment_role_default_min(text) from public;
revoke all on function app.assignment_role_min_grade(text) from public;
grant execute on function app.assignment_role_default_min(text) to authenticated;
grant execute on function app.assignment_role_min_grade(text) to authenticated;

-- ---- 2. 역할 최소 레벨 트리거 재작성 — 고정 규칙 → 회사 조정 반영 -------------

create or replace function app.enforce_assignment_role_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_min int;
  v_role_label text;
  v_level_label text;
begin
  -- 겸임은 PL·PM 중 높은 쪽, 나머지는 각자의 설정값(없으면 기본값)
  if new.assignment_role = 'pl_pm' then
    v_min := greatest(
      app.grade_rank(app.assignment_role_min_grade('pl')),
      app.grade_rank(app.assignment_role_min_grade('pm'))
    );
  elsif new.assignment_role in ('pl', 'pm', 'deputy_pm', 'member') then
    v_min := app.grade_rank(app.assignment_role_min_grade(new.assignment_role));
  else
    return new;
  end if;

  -- 최소가 레벨 6(staff)이면 전 직원 통과 — 담당 기본값의 '제한 없음' 유지
  if v_min <= app.grade_rank('staff') then
    return new;
  end if;

  select app.grade_rank(u.grade) into v_rank
  from public.users u where u.id = new.user_id;

  if coalesce(v_rank, 0) < v_min then
    v_role_label := case new.assignment_role
      when 'pl' then 'PL' when 'pl_pm' then 'PL·PM 겸임'
      when 'pm' then 'PM' when 'deputy_pm' then '부PM' else '담당' end;
    v_level_label := case v_min
      when 60 then '레벨 1' when 50 then '레벨 2' when 40 then '레벨 3'
      when 30 then '레벨 4' when 20 then '레벨 5' else '레벨 6' end;
    raise exception '% 역할은 % 이상만 지정할 수 있습니다.', v_role_label, v_level_label
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
